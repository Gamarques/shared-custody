export const MEMBER_COLORS = ["#2f6f5e", "#c2410c", "#1d4ed8", "#a21caf", "#b45309", "#be123c"] as const;

export interface OnboardingInput {
  familyName: string;
  displayName: string;
  color: string;
}

export type OnboardingErrors = Partial<Record<keyof OnboardingInput, string>>;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function validateOnboarding(input: OnboardingInput): OnboardingErrors {
  const errors: OnboardingErrors = {};
  const family = input.familyName.trim();
  const name = input.displayName.trim();
  if (family.length < 1 || family.length > 80) errors.familyName = "Informe o nome da família (até 80 caracteres).";
  if (name.length < 1 || name.length > 40) errors.displayName = "Informe seu nome de exibição (até 40 caracteres).";
  if (!HEX_COLOR.test(input.color)) errors.color = "Escolha uma cor.";
  return errors;
}
