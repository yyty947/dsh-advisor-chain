"""Replace the broken entryNode block in src/client.ts with a clean version."""
import io

PATH = "src/client.ts"
START = "      const entryNode = (index: number, entry: DraftChainEntry) =>"
END_MARKER = "}))));"

NEW = '''      const modelField = (index: number, entry: DraftChainEntry) => {
        const models = modelOptions[entry.provider] ?? [];
        const manual = !!manualModel[index] || models.length === 0;
        const control = manual
          ? h("input", {
              style: { ...SET.control, width: "100%", boxSizing: "border-box" },
              placeholder: "模型 id",
              value: entry.model,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { model: e.target.value }),
            })
          : h(Dropdown, {
              width: "100%",
              ariaLabel: "模型 id",
              value: entry.model,
              options: [
                ...models.map((id) => ({ value: id, label: id })),
                ...(entry.model && !models.includes(entry.model) ? [{ value: entry.model, label: entry.model }] : []),
              ],
              onChange: (e: { target: { value: string } }) => patchEntry(index, { model: e.target.value }),
            });
        return h(Field, { label: manual ? "模型 id（手动输入）" : "模型 id" },
          h("div", { style: { display: "flex", gap: 6, width: "100%" } },
            control,
            models.length > 0
              ? h("button", {
                  style: SET.btn, type: "button", title: manual ? "从已获取的模型列表中选择" : "手动输入其他模型 id",
                  onClick: () => setManualModel((prev) => ({ ...prev, [index]: !manual })),
                }, manual ? "列表选择" : "⌨")
              : null));
      };

      const entryNode = (index: number, entry: DraftChainEntry) =>
        h("div", { key: index, style: SET.entry },
          h("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 } },
            h("span", { style: { ...SET.desc, marginTop: 0, width: 22 } }, `#${index + 1}`),
            h("span", { style: { flex: 1 } }),
            h("button", {
              style: { ...SET.btn, opacity: fetchingProvider === entry.provider || !entry.provider ? 0.5 : 1 },
              type: "button",
              title: !entry.provider ? "先选择 provider 后再获取模型列表" : undefined,
              disabled: fetchingProvider === entry.provider || !entry.provider,
              onClick: () => fetchModels(entry.provider),
            }, fetchingProvider === entry.provider ? "获取中…" : "获取模型列表"),
            h("button", { style: SET.btn, type: "button", "aria-label": "上移", title: "上移", onClick: () => moveEntry(index, -1), disabled: index === 0 }, "↑"),
            h("button", { style: SET.btn, type: "button", "aria-label": "下移", title: "下移", onClick: () => moveEntry(index, 1), disabled: index === draft.chain.length - 1 }, "↓"),
            h("button", { style: SET.btn, type: "button", onClick: () => removeEntry(index) }, "删除")),
          h("div", { style: { display: "flex", gap: 12, flexWrap: "wrap" } },
            h(Field, { label: "显示名（可选）" }, h("input", {
              style: { ...SET.control, width: 150 },
              placeholder: "如：架构顾问",
              value: entry.label ?? "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { label: e.target.value }),
            })),
            h(Field, { label: "Provider" }, h(Dropdown, {
              width: "100%",
              ariaLabel: "Provider",
              value: entry.provider,
              options: providers.length > 0
                ? providers.map((p) => ({ value: p.id, label: p.name || p.id }))
                : [{ value: entry.provider, label: entry.provider || "（未获取到供应商）" }],
              onChange: (e: { target: { value: string } }) => patchEntry(index, { provider: e.target.value }),
            })),
            modelField(index, entry)),
          h("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 } },
            h(Field, { label: "推理档位" }, h(Dropdown, {
              width: 170,
              ariaLabel: "推理档位",
              value: entry.reasoningEffort ?? "",
              options: EFFORTS.map((effort) => ({ value: effort.value, label: effort.label })),
              onChange: (e: { target: { value: string } }) => patchEntry(index, { reasoningEffort: e.target.value || undefined }),
            })),
            h(Field, { label: "温度（0–2）" }, h("input", {
              style: { ...SET.control, width: 110 }, type: "number", min: 0, max: 2, step: 0.1,
              value: entry.temperature ?? "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { temperature: e.target.value === "" ? undefined : Number(e.target.value) }),
            })),
            h(Field, { label: "maxTokens" }, h("input", {
              style: { ...SET.control, width: 120 }, type: "number", min: 1,
              value: entry.maxTokens ?? "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { maxTokens: e.target.value === "" ? undefined : Number(e.target.value) }),
            })),
            h(Field, { label: "超时（毫秒）" }, h("input", {
              style: { ...SET.control, width: 130 }, type: "number", min: 1000, max: 600000, step: 500,
              value: entry.timeoutMs ?? "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { timeoutMs: e.target.value === "" ? undefined : Number(e.target.value) }),
            }))));'''

lines = io.open(PATH, encoding="utf-8").read().split("\n")
start_idx = next(i for i, line in enumerate(lines) if line.startswith(START))
end_idx = start_idx
while not lines[end_idx].rstrip().endswith(END_MARKER):
    end_idx += 1

replacement_lines = NEW.split("\n")
lines[start_idx:end_idx + 1] = replacement_lines
io.open(PATH, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
print(f"replaced lines {start_idx + 1}..{end_idx + 1} with {len(replacement_lines)} lines")
