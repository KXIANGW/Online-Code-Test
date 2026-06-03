#!/usr/bin/env python3
"""Render the canonical Grafana dashboards into a k8s ConfigMap manifest.

Single source of truth: infra/grafana/dashboards/*.json are the dashboards that
docker-compose Grafana provisions. k3s Grafana can't reference them via kustomize
configMapGenerator (ArgoCD enforces load restrictions that forbid ../ paths
outside k8s/), so this script emits a self-contained ConfigMap instead.

Regenerate after editing any dashboard:  make grafana-k8s-cm
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "infra" / "grafana" / "dashboards"
OUT = ROOT / "k8s" / "15-grafana-dashboards.yaml"

files = sorted(SRC.glob("*.json"))
if not files:
    raise SystemExit(f"no dashboards found in {SRC}")

lines = [
    "# GENERATED from infra/grafana/dashboards/*.json by infra/grafana/gen-k8s-dashboards-cm.py",
    "# DO NOT EDIT BY HAND — run `make grafana-k8s-cm` after changing a dashboard.",
    "apiVersion: v1",
    "kind: ConfigMap",
    "metadata:",
    "  name: grafana-dashboards",
    "  namespace: oct",
    "data:",
]
for f in files:
    content = json.dumps(json.load(f.open()), indent=2, ensure_ascii=False)
    lines.append(f"  {f.name}: |")
    lines.extend("    " + ln for ln in content.splitlines())

OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)} from {len(files)} dashboards: {[f.name for f in files]}")
