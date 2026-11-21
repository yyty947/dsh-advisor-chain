"""Replace the status/dock block (lines 1010..1044) in src/client.ts.

Line 1010 = the "// Status announcements render" comment; line 1044 (the
line ending with '))))+' + ';'? — actually the block ends at the line whose
content is exactly "        }));" closing AdvisorSettingsTab? No: the block
spans from the comment through the closing of the dock children and the
component's final return closing. We locate:
  start = line containing "Status announcements render"
  end   = the next line whose trimmed content ends with ')));' AND contains
          'SET.btnPrimary'  (the save button inside the dock/row render)
and replace that inclusive range with the new always-present sticky dock.
"""
import io, re

PATH = "src/client.ts"
lines = io.open(PATH, encoding="utf-8").read().split("\n")

start = next(i for i, l in enumerate(lines) if "Status announcements render" in l)
end = None
for i in range(start, min(start + 60, len(lines))):
    if "SET.btnPrimary" in lines[i]:
        end = i
        break
assert end is not None, "save button line not found"

NEW = '''        // The bottom dock is ALWAYS present (sticky): status message left,
        // actions right. The shell's trailing padding below our li is
        // cancelled with an equal negative margin so the dock sits flush at
        // the very bottom — no gap, no occlusion (li reserves dock height).
        h("div", {
          ref: (node: HTMLElement) => { (dockRef as { current: unknown }).current = node; },
          role: "status",
          "aria-live": "polite",
          style: {
            position: "sticky",
            bottom: 0,
            marginBottom: scrollerPad ? -scrollerPad : 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 16px",
            background: surface,
            borderTop: "1px solid var(--dsw-alias-border-l2)",
            borderRadius: "10px 10px 0 0",
            boxShadow: "0 -4px 16px rgba(0,0,0,0.12)",
          },
        },
          h("div", { style: { flex: 1, minWidth: 0, maxHeight: 54, overflowY: "auto" } },
            error
              ? h("div", { style: SET.msgErr }, error)
              : msg
                ? h("div", { style: SET.msgOk }, msg)
                : dirty
                  ? h("div", { style: SET.msgErr }, "有未保存更改")
                  : null),
          h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
            dirty ? h("button", { style: SET.btn, type: "button", onClick: () => reload({ silent: true }) }, "放弃修改") : null,
            h("button", { style: SET.btnPrimary, type: "button", disabled: saving, onClick: save }, saving ? "保存中…" : "保存"))));'''

lines[start:end + 1] = NEW.split("\n")
io.open(PATH, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
print(f"replaced lines {start + 1}..{end + 1}")
