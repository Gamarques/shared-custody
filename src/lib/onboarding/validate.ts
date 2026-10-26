export const MEMBER_COLORS = ["#2f6f5e", "#c2410c", "#1d4ed8", "#a21caf", "#b45309", "#be123c"] as const;

export interface OnboardingInput {
  familyName: string;
  displayName: string;
  color: string;
}

export type OnboardingErrors = Partial<Record<keyof OnboardingInput, string>>;

export type MemberProfileInput = Pick<OnboardingInput, "displayName" | "color">;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Display name and color, shared by onboarding and invite acceptance. */
export function validateMemberProfile(input: MemberProfileInput): OnboardingErrors {
  const errors: OnboardingErrors = {};
  const name = input.displayName.trim();
  if (name.length < 1 || name.length > 40) errors.displayName = "Indica o teu nome a mostrar (até 40 caracteres).";
  if (!HEX_COLOR.test(input.color)) errors.color = "Escolhe uma cor.";
  return errors;
}

export function validateOnboarding(input: OnboardingInput): OnboardingErrors {
  const errors = validateMemberProfile(input);
  const family = input.familyName.trim();
  if (family.length < 1 || family.length > 80) errors.familyName = "Indica o nome da família (até 80 caracteres).";
  return errors;
}
