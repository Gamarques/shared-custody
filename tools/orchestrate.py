"""Runs each plan task: classify with Jev -> pick Claude model -> `claude -p`.
Usage: python tools/orchestrate.py [T-01 T-02 ...]   (default: all T-01..T-24)
Requires TYPESAFE_API_KEY in env. Logs in tools/logs/.
"""
import json, os, re, subprocess, sys, urllib.request, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PLAN = ROOT / "docs" / "plano-mvp.md"
LOGS = ROOT / "tools" / "logs"
LOGS.mkdir(exist_ok=True)

ROUTE = {  # (choice, confident) -> (model, effort, max_turns)
    ("simple", True): ("haiku", "low", 20),
    ("simple", False): ("sonnet", "medium", 30),
    ("moderate", True): ("sonnet", "medium", 40),
    ("moderate", False): ("opus", "high", 40),
    ("complex", True): ("opus", "high", 60),
    ("complex", False): ("opus", "high", 60),
}


def parse_tasks():
    tasks = {}
    for line in PLAN.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\|\s*(T-\d\d)\s*\|(.+)\|\s*$", line)
        if m:
            cols = [c.strip() for c in m.group(2).split("|")]
            tasks[m.group(1)] = dict(id=m.group(1), title=cols[0], req=cols[1], accept=cols[2], size=cols[3])
    return tasks


def jev(task):
    desc = (f"{task['title']}. Acceptance: {task['accept']}. Size: {task['size']} (P<=half day, M=1 day, G>=2 days). "
            "Context: Next.js App Router + Supabase (Postgres, RLS, Auth, Storage) PWA, TypeScript.")
    body = {"state": desc, "model": "jev-latest", "questions": {"difficulty": {
        "type": "choice",
        "instructions": "How difficult is this software engineering task to complete correctly?",
        "criteria": {
            "simple": "Mechanical, narrow-scope: one file, no ambiguity, no architectural decisions.",
            "moderate": "Normal feature work: a few files, some design choices, needs tests but no deep tradeoffs.",
            "complex": "Needs multi-step reasoning, architecture decisions, cross-cutting changes, or high risk of subtle bugs.",
        }}}}
    req = urllib.request.Request("https://api.typesafe.ai/v1/systemone", json.dumps(body).encode(),
        {"Content-Type": "application/json", "Authorization": "Bearer " + os.environ["TYPESAFE_API_KEY"]})
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.load(r)
    return out


def main():
    tasks = parse_tasks()
    ids = sys.argv[1:] or [f"T-{i:02d}" for i in range(1, 25)]
    for tid in ids:
        t = tasks[tid]
        raw = jev(t)
        (LOGS / f"{tid}.jev.json").write_text(json.dumps(raw, indent=1))
        # tolerate either flat or nested response shapes
        d = raw["answers"]["difficulty"]
        choice, conf = d["choice"], d["confidence"]
        model, effort, turns = ROUTE[(choice, conf >= 0.6)]
        print(f"{tid} {t['title'][:60]} -> jev={choice}({conf:.2f}) model={model}", flush=True)
        prompt = (
            f"You are implementing task {tid} of the plan in docs/plano-mvp.md (read it first, esp. Requisitos, Modelo de dados, Regras de negocio).\n"
            f"Task: {t['title']}\nRequirements: {t['req']}\nAcceptance criteria: {t['accept']}\n\n"
            "Rules: work in the existing repo (earlier tasks are already committed; inspect before writing). TypeScript, "
            "Next.js App Router, Supabase. Money as integer cents. Write tests (vitest) and run them until they pass; "
            "RLS must be covered by SQL migrations in supabase/migrations. Parts needing real external accounts/devices "
            "(Vercel deploy, live Supabase project, physical Android/iOS) cannot be done: implement everything possible locally, "
            "and document the manual step in docs/MANUAL-STEPS.md. Do not fabricate results. When done, `git add -A && git commit -m \"" + tid + ": ...\"` and "
            "end with a 3-line summary of what was built, test status, and any gaps."
        )
        cmd = ["claude", "-p", prompt, "--model", model, "--effort", effort, "--max-turns", str(int(turns * float(os.environ.get("TURN_MULT", "1")))),
               "--permission-mode", "acceptEdits", "--allowedTools", "Bash", "Edit", "Write", "Read", "Glob", "Grep"]
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        (LOGS / f"{tid}.{model}.log").write_text(res.stdout + "\n--STDERR--\n" + res.stderr, encoding="utf-8")
        print(f"  exit={res.returncode} tail: {res.stdout.strip()[-300:]!r}", flush=True)
        if res.returncode != 0:
            print("STOPPING: task failed", flush=True)
            sys.exit(1)


if __name__ == "__main__":
    main()
