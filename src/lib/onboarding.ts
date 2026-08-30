const STORAGE_KEY = "chatui:onboarding";

interface OnboardingState {
  completedAt: string | null;
  step?: string | null;
}

export function isOnboardingDone(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw) as OnboardingState;
    return !!data.completedAt;
  } catch {
    return false;
  }
}

export function markOnboardingDone(): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ completedAt: new Date().toISOString() }),
  );
}

export function resetOnboarding(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function loadOnboardingStep(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as OnboardingState;
    return data.step ?? null;
  } catch {
    return null;
  }
}

export function saveOnboardingStep(step: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const prev = raw ? (JSON.parse(raw) as Partial<OnboardingState>) : {};
    const next: OnboardingState = {
      completedAt: prev.completedAt ?? null,
      step,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures; the wizard still works in memory.
  }
}
