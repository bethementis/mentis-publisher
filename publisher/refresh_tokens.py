"""인스타·쓰레드 장기 토큰을 연장하고 GitHub 비밀값을 갱신한다. 토큰 값은 로그에 절대 출력하지 않는다."""
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import platforms as P  # noqa: E402

repo = os.environ.get("GITHUB_REPOSITORY", "bethementis/mentis-publisher")
can_save = bool(os.environ.get("GH_TOKEN"))
status = 0
for name, env, fn, key in [("인스타그램", "IG_ACCESS_TOKEN", P.ig_refresh, "access_token"),
                           ("쓰레드", "THREADS_ACCESS_TOKEN", P.th_refresh, "access_token")]:
    tok = os.environ.get(env)
    if not tok:
        print(f"- {name}: 토큰 없음, 건너뜀"); continue
    try:
        new = fn(tok)[key]
        if can_save:
            subprocess.run(["gh", "secret", "set", env, "--repo", repo], input=new.encode(), check=True)
            print(f"✓ {name}: 토큰 연장 후 비밀값 갱신")
        else:
            print(f"! {name}: 연장은 됐지만 GH_PAT 비밀값이 없어 저장하지 못했어요")
            status = 1
    except Exception as e:  # noqa: BLE001
        print(f"✗ {name}: 연장 실패 ({e})"); status = 1
sys.exit(status)
