// 빌드 시점에 박힌 기본 OAuth + 시트 설정을 첫 실행 때 자동 적용.
// 팀원이 .exe만 받아 실행하면 이 함수가 호출되어 OAuth 입력/시트 추가/매핑을 건너뜀.
//
// 동작:
//  - 이미 사용자가 OAuth 저장돼 있으면 → no-op (덮어쓰기 안 함)
//  - 시트 설정도 마찬가지로 비어있을 때만 기본값 적용
//
// 빌드 타임 env 변수 (vite가 import.meta.env로 노출):
//   VITE_DEFAULT_GOOGLE_CLIENT_ID
//   VITE_DEFAULT_GOOGLE_CLIENT_SECRET
//   VITE_DEFAULT_SHEETS_CONFIG     // JSON: { sheetIds: string[], mappings: SheetMappings }

import { api } from './api';
import type { SheetMappings } from './sheetMapping';

interface SheetsConfig {
  sheetIds: string[];
  mappings: SheetMappings;
}

const DEFAULT_CLIENT_ID = (import.meta.env.VITE_DEFAULT_GOOGLE_CLIENT_ID as string) || '';
const DEFAULT_CLIENT_SECRET = (import.meta.env.VITE_DEFAULT_GOOGLE_CLIENT_SECRET as string) || '';
const DEFAULT_SHEETS_RAW = (import.meta.env.VITE_DEFAULT_SHEETS_CONFIG as string) || '';

let DEFAULT_SHEETS: SheetsConfig | null = null;
try {
  if (DEFAULT_SHEETS_RAW) DEFAULT_SHEETS = JSON.parse(DEFAULT_SHEETS_RAW);
} catch {
  // ignore — 잘못된 JSON이면 그냥 무시
}

export async function applyFirstRunDefaultsIfNeeded(): Promise<{ needsLogin: boolean }> {
  if (!api?.google || !api?.cfg) return { needsLogin: false };

  let needsLogin = false;

  // 1) OAuth Client ID/Secret — 비어있을 때만 기본값 박기
  if (DEFAULT_CLIENT_ID && DEFAULT_CLIENT_SECRET) {
    try {
      const status = await api.google.status();
      const alreadyHasCreds = status.ok && status.data?.hasClient;
      const alreadyAuthed = status.ok && status.data?.authed;

      // 저장된 Client ID가 이 빌드의 기본값과 다르면 = 옛 배포본에서 넘어온 잘못된 값.
      // (2.0.53 처럼 인증정보가 빠진 채 빌드된 버전을 쓰다 온 경우)
      // 그대로 두면 "401 invalid_client / The OAuth client was not found" 로 영원히 로그인 불가.
      // NSIS가 deleteAppDataOnUninstall:false 라 재설치해도 설정이 안 지워지므로 앱이 직접 고쳐야 한다.
      let staleClient = false;
      if (alreadyHasCreds) {
        try {
          const sec = await api.google.revealSecrets();
          const storedId = (sec.ok ? sec.data?.clientId : '') || '';
          staleClient = storedId.trim() !== DEFAULT_CLIENT_ID.trim();
        } catch {
          // 확인 불가하면 건드리지 않음
        }
      }

      if (!alreadyHasCreds || staleClient) {
        await api.google.setCreds({ clientId: DEFAULT_CLIENT_ID, clientSecret: DEFAULT_CLIENT_SECRET });
        if (staleClient) {
          // 다른 client로 발급된 토큰은 무효 — 지우고 재로그인시킨다
          await api.google.signOut();
        }
        // eslint-disable-next-line no-console
        console.info(`[first-run] OAuth Client 기본값 적용 완료${staleClient ? ' (옛 설정 자동 교체)' : ''}`);
      }
      // 로그인이 한 번도 안 된 상태면 자동으로 OAuth 시작 — 팀원이 버튼 찾을 필요 X
      if (!alreadyAuthed || staleClient) {
        needsLogin = true;
      }
    } catch {
      // non-fatal
    }
  }

  // 2) 시트 ID + 매핑 — 비어있으면 기본값 박고, 일부만 등록돼있으면 누락된 default ID를 합쳐줌
  // (이미 사용 중인 사용자도 새로 추가된 default 시트를 자동으로 받아볼 수 있도록)
  if (DEFAULT_SHEETS && DEFAULT_SHEETS.sheetIds.length > 0) {
    try {
      const cur = await api.cfg.get<{ list?: { spreadsheetId: string; url: string }[] }>('sheetIds');
      const curList = cur.ok && cur.data && Array.isArray(cur.data.list) ? cur.data.list : [];
      const have = new Set(curList.map((x) => x.spreadsheetId));
      const missing = DEFAULT_SHEETS.sheetIds.filter((id) => !have.has(id));
      if (curList.length === 0) {
        const list = DEFAULT_SHEETS.sheetIds.map((id) => ({ spreadsheetId: id, url: id }));
        await api.cfg.set('sheetIds', { list });
        // eslint-disable-next-line no-console
        console.info('[first-run] 시트 ID 기본값 적용:', list.length, '개');
      } else if (missing.length > 0) {
        const merged = [...curList, ...missing.map((id) => ({ spreadsheetId: id, url: id }))];
        await api.cfg.set('sheetIds', { list: merged });
        // eslint-disable-next-line no-console
        console.info('[first-run] 누락된 default 시트 자동 추가:', missing);
      }
    } catch {
      // non-fatal
    }

    try {
      const curMap = await api.cfg.get<SheetMappings>('sheetMappings');
      const hasMap = curMap.ok && curMap.data && Object.keys(curMap.data).length > 0;
      if (!hasMap) {
        await api.cfg.set('sheetMappings', DEFAULT_SHEETS.mappings);
        // eslint-disable-next-line no-console
        console.info('[first-run] 시트 매핑 기본값 적용:', Object.keys(DEFAULT_SHEETS.mappings).length, '개');
      }
    } catch {
      // non-fatal
    }
  }

  return { needsLogin };
}

// 첫 실행 자동 로그인 — 기본값이 박혀있고 인증 안 된 상태면 즉시 OAuth 팝업.
// 사용자는 [⚙️ 설정] 메뉴 들어갈 필요 없이 첫 화면에서 바로 Google 계정 선택만 하면 끝.
export async function autoTriggerLoginIfNeeded(needsLogin: boolean): Promise<boolean> {
  if (!needsLogin) return false;
  if (!api?.google) return false;
  try {
    const r = await api.google.startAuth();
    return !!r.ok;
  } catch {
    return false;
  }
}
