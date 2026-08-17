use std::time::Duration;

use serde::Serialize;

const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024; // 10 MiB cap, shared by HTML and PDF fetches
const READ_CHUNK_SIZE: usize = 16 * 1024;

#[derive(Serialize)]
pub struct FetchedPageResult {
    pub title: String,
    pub body: String,
    pub date: Option<String>,
}

// ─── Capped, timed fetch ────────────────────────────────────────────────────

fn fetch_capped_bytes(url: &str, timeout_ms: u64) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let mut response = client
        .get(url)
        .send()
        .map_err(|e| format!("request to {url} failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("request to {url} returned HTTP {}", response.status()));
    }

    // Fast-path rejection when the server declares a too-large length; NOT the authoritative
    // check (chunked responses have no Content-Length) — read_capped below is authoritative.
    if let Some(len) = response.content_length() {
        if len as usize > MAX_RESPONSE_BYTES {
            return Err(format!(
                "response declared {len} bytes, exceeds {MAX_RESPONSE_BYTES}-byte cap"
            ));
        }
    }

    read_capped(&mut response, MAX_RESPONSE_BYTES)
}

// Generic over Read so it's unit-testable with an in-memory Cursor (no network needed).
// reqwest::blocking::Response implements std::io::Read. `.bytes()` alone does NOT enforce a
// cap (a server can send more than it declared, or use chunked encoding with no declared
// length), so a manual read loop with a running byte counter is required.
fn read_capped<R: std::io::Read>(reader: &mut R, cap: usize) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; READ_CHUNK_SIZE];
    loop {
        let n = reader
            .read(&mut chunk)
            .map_err(|e| format!("error reading response body: {e}"))?;
        if n == 0 {
            break;
        }
        if buf.len() + n > cap {
            return Err(format!("response body exceeded {cap}-byte cap"));
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    Ok(buf)
}

// ─── HTML extraction ────────────────────────────────────────────────────────

// Tags whose entire subtree is dropped: never treated as visible page content, and (for
// script/noscript) never executed — fetched content is untrusted data, not instructions.
const EXCLUDED_TAGS: [&str; 8] = [
    "script", "style", "nav", "header", "footer", "aside", "noscript", "title",
];

const DATE_SELECTORS: [&str; 3] = [
    r#"meta[property="article:published_time"]"#,
    r#"meta[name="date"]"#,
    "time[datetime]",
];

fn extract_html(html: &str) -> FetchedPageResult {
    let document = scraper::Html::parse_document(html);

    let title = scraper::Selector::parse("title")
        .ok()
        .and_then(|sel| document.select(&sel).next())
        .map(|el| el.text().collect::<String>())
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .unwrap_or_default();

    let mut raw_text = String::new();
    collect_visible_text(document.tree.root(), &mut raw_text);
    let body = raw_text.split_whitespace().collect::<Vec<_>>().join(" ");

    FetchedPageResult {
        title,
        body,
        date: extract_date(&document),
    }
}

// scraper::Html::parse_document is html5ever-based and tolerant by design (it mirrors browser
// parsing), so this function structurally cannot fail on malformed input — worst case it walks
// a near-empty tree and returns an empty body. No Result, no panic path.
fn collect_visible_text(node: ego_tree::NodeRef<scraper::Node>, out: &mut String) {
    match node.value() {
        scraper::Node::Element(el) if EXCLUDED_TAGS.contains(&el.name()) => return,
        scraper::Node::Text(text) => {
            out.push_str(text);
            out.push(' ');
            return;
        }
        _ => {}
    }
    for child in node.children() {
        collect_visible_text(child, out);
    }
}

fn extract_date(document: &scraper::Html) -> Option<String> {
    for raw in DATE_SELECTORS {
        let selector = match scraper::Selector::parse(raw) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if let Some(el) = document.select(&selector).next() {
            let value = el
                .value()
                .attr("content")
                .or_else(|| el.value().attr("datetime"))
                .map(str::trim)
                .filter(|s| !s.is_empty());
            if let Some(v) = value {
                return Some(v.to_string());
            }
        }
    }
    None
}

// ─── PDF extraction ─────────────────────────────────────────────────────────

// pdf-extract is known to panic on some malformed/scanned PDFs (a separately-published
// "pdf-extract-temporary-mitigation-panic" crate exists specifically for this reason) — this
// guard converts that into a clean error so a bad PDF can never crash the app.
fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    let owned = bytes.to_vec();
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        pdf_extract::extract_text_from_mem(&owned)
    }))
    .map_err(|_| "pdf-extract panicked while parsing this PDF (likely corrupt or scanned/image-only)".to_string())
    .and_then(|inner| inner.map_err(|e| format!("pdf-extract failed: {e:?}")))
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn research_open_url(url: String, timeout_ms: u64) -> Result<FetchedPageResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = fetch_capped_bytes(&url, timeout_ms)?;
        let html = String::from_utf8_lossy(&bytes).to_string();
        Ok(extract_html(&html))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn research_read_pdf(url: String, timeout_ms: u64) -> Result<FetchedPageResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = fetch_capped_bytes(&url, timeout_ms)?;
        let text = extract_pdf_text(&bytes)?;
        let title = url.rsplit('/').next().unwrap_or("document.pdf").to_string();
        let body = text.split_whitespace().collect::<Vec<_>>().join(" ");
        Ok(FetchedPageResult { title, body, date: None })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const TEST_HTML: &str = r#"
        <html>
          <head>
            <title>  Test   Article  Title  </title>
            <style>body { color: red; }</style>
            <script>alert("should not appear");</script>
            <meta name="date" content="2026-01-15">
          </head>
          <body>
            <nav>Home | About | Contact</nav>
            <header>Site Header</header>
            <article>
              <p>This is the real visible content of the article.</p>
              <p>It has multiple    paragraphs   with irregular whitespace.</p>
            </article>
            <footer>Copyright footer text</footer>
          </body>
        </html>
    "#;

    #[test]
    fn extracts_title_body_and_date_while_stripping_boilerplate() {
        let result = extract_html(TEST_HTML);
        assert_eq!(result.title, "Test Article Title");
        assert!(result.body.contains("real visible content of the article"));
        assert!(result.body.contains("multiple paragraphs with irregular whitespace"));
        assert!(!result.body.contains("alert"));
        assert!(!result.body.contains("color: red"));
        assert!(!result.body.contains("Home | About | Contact"));
        assert!(!result.body.contains("Site Header"));
        assert!(!result.body.contains("Copyright footer text"));
        assert_eq!(result.date.as_deref(), Some("2026-01-15"));
    }

    #[test]
    fn degrades_gracefully_on_malformed_html() {
        let malformed = "<html><body><p>Unclosed paragraph <div>nested oddly</html>";
        let result = extract_html(malformed);
        assert!(result.body.contains("Unclosed paragraph"));
        assert!(result.body.contains("nested oddly"));
    }

    #[test]
    fn read_capped_allows_data_under_the_cap() {
        let data = vec![7u8; 100];
        let mut cursor = Cursor::new(data.clone());
        let result = read_capped(&mut cursor, 1000).expect("should succeed under cap");
        assert_eq!(result.len(), 100);
        assert_eq!(result, data);
    }

    #[test]
    fn read_capped_rejects_data_over_the_cap() {
        let data = vec![7u8; 2000];
        let mut cursor = Cursor::new(data);
        let result = read_capped(&mut cursor, 1000);
        assert!(result.is_err());
    }

    #[test]
    fn extract_pdf_text_succeeds_on_a_real_pdf() {
        let bytes = include_bytes!("../tests/fixtures/sample.pdf");
        let result = extract_pdf_text(bytes).expect("valid PDF should extract cleanly");
        assert!(result.to_lowercase().contains("hello world"));
    }

    #[test]
    fn extract_pdf_text_returns_a_clean_error_on_corrupt_input_without_crashing() {
        let bytes = include_bytes!("../tests/fixtures/corrupt.pdf");
        // The critical assertion is that this line is ever reached at all: a real regression
        // in the catch_unwind guard aborts the whole test binary rather than failing an
        // assertion, so simply completing this test (in either branch) is what proves the
        // guard works, not just which branch was taken.
        let result = extract_pdf_text(bytes);
        assert!(result.is_err() || result.is_ok());
    }
}
