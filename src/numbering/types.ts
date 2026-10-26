/**
 * 견적번호 발급 경계의 타입과 오류 문구.
 *
 * 화면·계산 코드는 이 파일의 `QuoteNumberStore`만 안다.
 * 지금은 브라우저 저장소 구현(browser.ts)을 쓰고, 나중에 서버 DB 구현으로 바꿔 끼운다.
 */

export const MSG_UNKNOWN_STAFF = "작성자를 선택하세요.";
export const MSG_EXHAUSTED = "해당 날짜의 견적번호를 모두 사용했습니다.";
export const MSG_MANUAL_INVALID = "견적번호는 1~100자로 입력하세요.";
export const MSG_DUPLICATE = "이미 발급된 견적번호입니다. 다른 번호를 입력하세요.";
export const MSG_DATE_INVALID = "작성일을 YYYY-MM-DD 형식으로 입력하세요.";

/** 견적번호 규칙 위반. message는 화면에 그대로 보여 주는 한국어 문구다. */
export class QuoteNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteNumberError";
  }
}

/** 발급 이력 한 건 */
export interface QuoteNumberEntry {
  /** 작성일 YYYY-MM-DD */
  date: string;
  /** 담당자 id (STAFF_CONFIG의 id) */
  staffId: string;
  /** 실제로 파일에 들어간 견적번호 */
  number: string;
  /** 직접 입력한 번호면 true, 자동 번호면 false */
  manual: boolean;
}

/** 번호 계산에 필요한 담당자 정보 (Staff의 일부) */
export interface StaffStart {
  id: string;
  /** 그날 이 담당자가 처음 받는 일련번호 (1~999). 엄격한 구간이 아니라 시작점이다. */
  start: number;
}

/**
 * 견적번호 발급 경계.
 *
 * 모든 메서드는 비동기다. 서버 구현으로 바꿔도 호출부를 고치지 않기 위해서다.
 * 규칙 위반은 `QuoteNumberError`로 거부(reject)한다.
 *
 * 사용 순서
 * 1. 화면은 `previewNext`(자동) 또는 `checkManual`(직접 입력)로 쓸 번호를 정한다. 이 단계는 아무것도 소비하지 않는다.
 * 2. 그 번호로 파일을 만든다. PDF와 Excel을 함께 만들 때도 번호는 하나다.
 * 3. **record는 파일 생성이 모두 성공한 뒤에만 호출한다.** 함께 저장이면 두 파일이 모두 성공한 뒤 한 번만 호출한다.
 *    생성이 실패하면 record를 부르지 않으며, 그 번호는 쓰지 않은 것으로 친다.
 *
 * 브라우저 구현에서는 브라우저·탭마다 이력이 따로 있어 번호가 겹칠 수 있다(받아들인 한계).
 */
export interface QuoteNumberStore {
  /**
   * 그 작성일·담당자의 다음 자동 번호를 미리 본다. 기록하지 않는다.
   * 모르는 담당자면 "작성자를 선택하세요.", 999를 넘으면 "해당 날짜의 견적번호를 모두 사용했습니다."로 거부한다.
   */
  previewNext(date: string, staffId: string): Promise<string>;
  /**
   * 직접 입력 번호가 쓸 수 있는지 검사한다. 기록하지 않는다.
   * 형식 오류면 "견적번호는 1~100자로 입력하세요.", 이미 발급된 번호면 "이미 발급된 견적번호입니다. 다른 번호를 입력하세요."로 거부한다.
   */
  checkManual(number: string): Promise<void>;
  /**
   * 발급 이력에 한 건을 기록한다.
   * **record는 파일 생성이 모두 성공한 뒤에만 호출한다.** 실패한 생성은 아무것도 소비하지 않는다.
   */
  record(entry: QuoteNumberEntry): Promise<void>;
}
