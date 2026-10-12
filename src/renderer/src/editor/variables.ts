import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { StateEffect, StateField, type Extension, RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, hoverTooltip, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { VariableHint } from '@shared/model'
import { VARIABLE_RE } from '@shared/variables'
import { i18n } from '../i18n'

export const setHints = StateEffect.define<Record<string, VariableHint>>()

const hintsField = StateField.define<Record<string, VariableHint>>({
  create: () => ({}),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHints)) return e.value
    return value
  }
})

const okMark = Decoration.mark({ class: 'cm-var cm-var-ok' })
const missingMark = Decoration.mark({ class: 'cm-var cm-var-missing' })

function buildDecorations(view: EditorView): DecorationSet {
  const hints = view.state.field(hintsField)
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    for (const m of text.matchAll(VARIABLE_RE)) {
      const start = from + (m.index ?? 0)
      builder.add(start, start + m[0].length, m[1] in hints ? okMark : missingMark)
    }
  }
  return builder.finish()
}

const decorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(setHints)))) {
        this.decorations = buildDecorations(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

/** Подсказка значения при наведении на `{{name}}` */
const tooltip = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos)
  for (const m of line.text.matchAll(VARIABLE_RE)) {
    const start = line.from + (m.index ?? 0)
    const end = start + m[0].length
    if (pos < start || pos > end) continue
    const hint = view.state.field(hintsField)[m[1]]
    return {
      pos: start,
      end,
      above: true,
      create() {
        const dom = document.createElement('div')
        dom.className = 'cm-var-tooltip'
        const name = document.createElement('div')
        name.className = 'cm-var-tooltip-name'
        name.textContent = m[1]
        dom.appendChild(name)
        const value = document.createElement('div')
        if (hint) {
          value.className = 'cm-var-tooltip-value'
          value.textContent = hint.value === '' ? i18n.t('variables.emptyValue') : hint.value
          const src = document.createElement('div')
          src.className = 'cm-var-tooltip-source'
          src.textContent =
            i18n.t(`variables.scope.${hint.source}`) + (hint.isSecret ? ` · ${i18n.t('variables.secret')}` : '')
          dom.appendChild(value)
          dom.appendChild(src)
        } else {
          value.className = 'cm-var-tooltip-missing'
          value.textContent = i18n.t('variables.unresolved')
          dom.appendChild(value)
        }
        return { dom }
      }
    }
  }
  return null
})

function completeVariables(ctx: CompletionContext): CompletionResult | null {
  const before = ctx.matchBefore(/\{\{\s*[^{}\s]*$/)
  if (!before) return null
  const prefixLen = before.text.match(/^\{\{\s*/)?.[0].length ?? 2
  const hints = ctx.state.field(hintsField, false) ?? {}
  const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2)
  const close = after === '}}' ? '' : '}}'
  return {
    from: before.from + prefixLen,
    options: Object.entries(hints).map(([name, h]) => ({
      label: name,
      detail: h.isSecret ? '•••••' : h.value.length > 40 ? `${h.value.slice(0, 40)}…` : h.value,
      info: i18n.t(`variables.scope.${h.source}`),
      type: 'variable',
      apply: `${name}${close}`
    })),
    validFor: /^[^{}\s]*$/
  }
}

export function variablesExtension(withAutocomplete = true): Extension {
  return [
    hintsField,
    decorations,
    tooltip,
    withAutocomplete ? autocompletion({ override: [completeVariables], activateOnTyping: true }) : []
  ]
}
