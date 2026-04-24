/**
 * 비밀번호 정책 검증
 *
 * 최소 기준:
 *  - 10자 이상
 *  - 영문 대소문자·숫자·특수문자 중 최소 3종
 *  - 상식적 쉬운 비밀번호 거부 (사용자 이름·이메일 포함, 공통 비번 블랙리스트)
 */

const COMMON_WEAK = new Set([
  "password", "password123", "admin", "admin123", "admin1234",
  "qwerty", "qwerty123", "abc123", "abcd1234", "abcdef",
  "12345678", "1234567890", "111111", "iloveyou",
  "letmein", "welcome", "welcome1", "changeme",
  "tempt1234", "temp1234", "test1234", "testtest",
  "p@ssword", "p@ssw0rd", "password1", "password!",
  "korea1234", "seoul1234", "apply1234", "청약1234",
]);

export interface PasswordCheck {
  ok: boolean;
  score: number;  // 0-5
  issues: string[];
}

export function validatePassword(
  password: string,
  context?: { email?: string; name?: string },
): PasswordCheck {
  const issues: string[] = [];
  let score = 0;

  if (!password || password.length < 10) {
    issues.push("최소 10자 이상");
  } else {
    score++;
  }

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^\w\s]/.test(password);
  const kinds = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;
  if (kinds < 3) {
    issues.push("영문 대문자·소문자·숫자·특수문자 중 최소 3종 포함");
  } else {
    score += kinds;
  }

  const lower = password.toLowerCase();
  if (COMMON_WEAK.has(lower) || COMMON_WEAK.has(lower.replace(/[^a-z0-9]/g, ""))) {
    issues.push("널리 알려진 쉬운 비밀번호는 사용 불가");
    score = 0;
  }

  // 이메일·이름과의 유사성 체크
  if (context?.email) {
    const local = context.email.split("@")[0].toLowerCase();
    if (local.length >= 3 && lower.includes(local)) {
      issues.push("이메일 아이디를 포함하지 마세요");
      score = Math.min(score, 1);
    }
  }
  if (context?.name) {
    const name = context.name.toLowerCase().trim();
    if (name.length >= 2 && lower.includes(name)) {
      issues.push("이름을 포함하지 마세요");
      score = Math.min(score, 1);
    }
  }

  // 반복·순차 패턴
  if (/(.)\1{3,}/.test(password)) {
    issues.push("같은 문자가 4번 이상 반복되면 안 됩니다");
    score = Math.min(score, 2);
  }
  if (
    /0123456789|1234567890|abcdefghij|qwertyuiop/i.test(password)
  ) {
    issues.push("연속된 키보드 순서는 피해주세요");
    score = Math.min(score, 2);
  }

  return {
    ok: issues.length === 0,
    score: Math.min(score, 5),
    issues,
  };
}
