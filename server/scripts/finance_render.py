#!/usr/bin/env python3
"""finance_render.py — 从 financial-data.json 渲染 financial-model.xlsx + 3 张 PNG 图表（matplotlib）。
用法：python finance_render.py financial-data.json out_dir
financial-data.json 结构：{"assumptions": {...}, "years": [2026,...], "income": [...], "cashflow": [...], "balance": [...]}
每张表为 {"headers": [...], "rows": [[...], ...]}，金额单位：元。
"""
import json
import pathlib
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei"]
plt.rcParams["axes.unicode_minus"] = False


def wan(v):
    return v / 10000.0


def main():
    data_path = pathlib.Path(sys.argv[1])
    out_dir = pathlib.Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    data = json.loads(data_path.read_text(encoding="utf-8"))
    years = [str(y) for y in data["years"]]

    # ---- xlsx ----
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "假设"
    ws.append(["参数", "值"])
    for k, v in data["assumptions"].items():
        ws.append([k, json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v])
    for name, sheet in (("利润表", "income"), ("现金流量表", "cashflow"), ("资产负债表", "balance")):
        w = wb.create_sheet(name)
        t = data[sheet]
        w.append(t["headers"])
        for row in t["rows"]:
            w.append(row)
    wb.save(out_dir / "financial-model.xlsx")

    # ---- charts ----
    income = data["income"]
    revenue_idx = income["headers"].index("营业收入")
    net_idx = income["headers"].index("净利润")
    revenue = [wan(r[revenue_idx]) for r in income["rows"]]
    net = [wan(r[net_idx]) for r in income["rows"]]
    cf = data["cashflow"]
    endcash_idx = cf["headers"].index("期末现金")
    cash = [wan(r[endcash_idx]) for r in cf["rows"]]

    def barline(fname, values, title, color):
        fig, ax = plt.subplots(figsize=(7.2, 4.2), dpi=150)
        bars = ax.bar(years, values, color=color, width=0.55)
        ax.set_title(title, fontsize=14)
        ax.set_ylabel("金额（万元）")
        ax.grid(axis="y", alpha=0.3)
        for b, v in zip(bars, values):
            ax.text(b.get_x() + b.get_width() / 2, b.get_height(), f"{v:.1f}", ha="center", va="bottom", fontsize=10)
        fig.tight_layout()
        fig.savefig(out_dir / fname)
        plt.close(fig)

    barline("revenue-growth.png", revenue, "营业收入预测（万元）", "#2563eb")
    barline("profit-growth.png", net, "净利润预测（万元）", "#059669")
    barline("cash-flow.png", cash, "期末现金预测（万元）", "#d97706")

    print("OK", out_dir)


if __name__ == "__main__":
    main()
