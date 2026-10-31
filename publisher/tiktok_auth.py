"""틱톡 로그인 후 받은 code를 refresh token으로 바꿔 GitHub 비밀값 TT_REFRESH_TOKEN 에 저장. 토큰은 출력하지 않는다."""
import os
import subprocess
import sys
from urllib.parse import unquote

import requests

REDIRECT = "https://github.com/bethementis/mentis-publisher"
code = unquote(os.environ["TT_CODE"].strip())
r = requests.post("https://open.tiktokapis.com/v2/oauth/token/", data={
    "client_key": os.environ["TT_CLIENT_KEY"].strip(),
    "client_secret": os.environ["TT_CLIENT_SECRET"].strip(),
    "code": code, "grant_type": "authorization_code", "redirect_uri": REDIRECT,
}, timeout=60)
d = r.json()
if "refresh_token" not in d:
    print(f"✗ 실패: {d.get('error')} {d.get('error_description')}")
    sys.exit(1)
repo = os.environ.get("GITHUB_REPOSITORY", "bethementis/mentis-publisher")
subprocess.run(["gh", "secret", "set", "TT_REFRESH_TOKEN", "--repo", repo], input=d["refresh_token"].encode(), check=True)
print(f"✓ 틱톡 연결 완료 (scope: {d.get('scope')}, refresh token 유효 {int(d.get('refresh_expires_in', 0))//86400}일)")
