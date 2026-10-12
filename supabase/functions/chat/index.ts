import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { message, session_id } = await req.json();

    if (!message) {
      return new Response(JSON.stringify({ error: "Missing message" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Call LLM (e.g., OpenAI). Here we mock it as an example.
    // In a real app, you would use Deno.env.get("OPENAI_API_KEY")
    // and make a fetch to https://api.openai.com/v1/chat/completions
    
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    const reply = `(Edge Function generated) I received your message: "${message}". This was generated on the server so it continues even if you close the app.`;

    // Note: Here we could optionally write the response directly to the Supabase database
    // using the @supabase/supabase-js client if we wanted to save it server-side.
    // For now, we return it to the client.
    
    return new Response(
      JSON.stringify({ reply }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
