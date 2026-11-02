// 맨티스 업로드 툴 로그인 중계 (Cloudflare Worker)
//
// 웹페이지(GitHub Pages)에는 비밀값을 넣을 수 없어서, "GitHub로 로그인" 의
// 마지막 단계(code → 토큰 교환)만 여기서 대신 해준다. 저장하는 데이터는 없다.
//
//   GET /login     → GitHub 로그인 화면으로 보냄
//   GET /callback  → GitHub 가 돌려준 code 를 토큰으로 바꿔서 웹페이지로 돌려보냄
//
// 설정값 (wrangler.toml [vars]): GITHUB_CLIENT_ID, APP_URL
// 비밀값 (Cloudflare 대시보드에서 직접 입력): GITHUB_CLIENT_SECRET

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/login") return login(url, env);
    if (url.pathname === "/callback") return callback(request, url, env);
    return new Response("mentis uploader auth", { status: 200 });
  },
};

function login(url, env) {
  const state = crypto.randomUUID();
  const gh = new URL("https://github.com/login/oauth/authorize");
  gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  gh.searchParams.set("redirect_uri", `${url.origin}/callback`);
  gh.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: gh.toString(),
      // 다른 사이트가 로그인 흐름을 가로채지 못하게 state 를 쿠키로 확인한다
      "Set-Cookie": `state=${state}; Path=/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

async function callback(request, url, env) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookie = request.headers.get("Cookie") || "";
  if (!code || !state || !cookie.split(/;\s*/).includes(`state=${state}`)) {
    return back(env, { error: "로그인 확인에 실패했어요. 다시 시도해 주세요." });
  }
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/callback`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    return back(env, { error: `GitHub 로그인 실패: ${data.error_description || data.error || res.status}` });
  }
  // 토큰은 주소의 # 뒤에 붙여 보낸다. # 뒤는 서버로 전송되지 않고 브라우저 안에만 머문다.
  return back(env, { token: data.access_token });
}

function back(env, params) {
  const target = `${env.APP_URL}#${new URLSearchParams(params)}`;
  return new Response(null, {
    status: 302,
    headers: { Location: target, "Set-Cookie": "state=; Path=/callback; Max-Age=0" },
  });
}
