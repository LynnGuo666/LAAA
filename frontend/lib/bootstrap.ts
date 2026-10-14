/**
 * Auth bootstrap：应用挂载时的静默会话恢复（token A2 方案）。
 *
 * token 只存内存，页面刷新后丢失，所以每次加载都要走一遍：
 * 1. 内存已有 accessToken（SPA 内导航）→ 直接返回
 * 2. localStorage 有旧版残留 refresh_token → 用它换新 token，
 *    后端会同步 Set-Cookie；成功后删除残留、拉取用户
 * 3. 内存还有 refresh token（无 access 的边缘态）→ 放 body 刷新
 * 4. 都没有 → 发空 body refresh 依赖 laaa_refresh cookie
 *    （用户刷新页面后内存丢失、但 HttpOnly cookie 仍有效的场景）
 *
 * 全部失败 → 保持未登录状态（清掉可能的残留）。
 *
 * 多 tab：本模块监听 storage 事件——其他 tab 登出清掉 localStorage
 * 旧 key 时，本 tab 也一并登出（token 本身不跨 tab 同步，各 tab 独立
 * silent refresh，后端有旋转兜底）。
 */
import { useAuthStore } from './store';
import axios from 'axios';
import { API_URL, refreshAccessToken } from './api';

const LEGACY_ACCESS_TOKEN_KEY = 'access_token';
const LEGACY_REFRESH_TOKEN_KEY = 'refresh_token';
// 登出广播 key（与 lib/store.ts 的 logout 保持一致）
const LOGOUT_BROADCAST_KEY = 'laaa_logout';

function clearLegacyTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
}

async function fetchMe(accessToken: string) {
  const response = await axios.get(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    withCredentials: true,
  });
  return response.data;
}

/** refresh 并把返回的 token + user 写入 store（共享 api.ts 的单例） */
async function refreshAndRestore(refreshToken: string | undefined) {
  // refreshAccessToken 成功时已把新 token 写入 store
  const { access_token } = await refreshAccessToken(refreshToken);
  const user = await fetchMe(access_token);
  // fetchMe 期间可能有并发 refresh 又旋转了 token；store 里的当前值
  // 永远不比返回值旧，优先用它，避免把已作废的旧 refresh token 写回内存
  const state = useAuthStore.getState();
  useAuthStore.getState().setAuth(user, state.accessToken ?? access_token, state.refreshToken ?? '');
  return true;
}

let bootstrapPromise: Promise<void> | null = null;

async function runBootstrap(): Promise<void> {
  // SSR / 静态导出预渲染阶段无事可做
  if (typeof window === 'undefined') return;

  // 清理上一次会话遗留的登出广播标记（残留无副作用，但避免无限累积）
  localStorage.removeItem(LOGOUT_BROADCAST_KEY);

  const { accessToken, refreshToken } = useAuthStore.getState();
  if (accessToken) return; // 内存 token 尚未失效，SPA 内导航

  // 路径 1：旧版 localStorage 残留 → 迁移到内存 + cookie
  const legacyRefreshToken = localStorage.getItem(LEGACY_REFRESH_TOKEN_KEY);
  if (legacyRefreshToken) {
    try {
      await refreshAndRestore(legacyRefreshToken);
      clearLegacyTokens();
      return;
    } catch {
      // 残留 token 已失效（旋转后旧值立即作废），清掉继续
      clearLegacyTokens();
    }
  }

  // 路径 2：内存还有 refresh token（无 access 的边缘态）→ 放 body 刷新
  if (refreshToken) {
    try {
      await refreshAndRestore(refreshToken);
      return;
    } catch {
      // 落到路径 3
    }
  }

  // 路径 3：纯 cookie 形态——发空 body 依赖 laaa_refresh cookie
  try {
    await refreshAndRestore(undefined);
  } catch {
    // 未登录 / cookie 过期：保持现状。若 persist 的 user 是过期登录态
    // （比如后端已删除会话），在这里校正为已登出。
    const state = useAuthStore.getState();
    if (state.isAuthenticated) {
      state.logout();
    }
  }
}

/** 幂等入口：并发调用共享同一个 promise */
export function bootstrapAuth(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrap().catch(() => {
      // bootstrap 失败不应阻塞渲染；静默保持未登录
    });
  }
  return bootstrapPromise;
}

let storageListenerAttached = false;

/** 多 tab 同步：其他 tab 登出时，本 tab 也登出 */
export function attachCrossTabLogoutListener() {
  if (typeof window === 'undefined' || storageListenerAttached) return;
  storageListenerAttached = true;
  window.addEventListener('storage', (event) => {
    // store.logout 写入的显式登出广播（时间戳每次不同，保证 storage 事件一定触发）。
    // newValue === null 是 removeItem（bootstrap 启动清理残留），不是登出信号。
    if (
      event.key === LOGOUT_BROADCAST_KEY &&
      event.newValue !== null &&
      useAuthStore.getState().isAuthenticated
    ) {
      useAuthStore.getState().logout();
    }
  });
}
