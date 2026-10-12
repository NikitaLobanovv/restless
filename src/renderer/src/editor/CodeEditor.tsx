import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  type KeyBinding
} from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { useData } from '../store/data'
import { editorHighlight, editorTheme } from './theme'
import { setHints, variablesExtension } from './variables'

export type EditorLanguage = 'json' | 'xml' | 'html' | 'text'

function languageExt(lang: EditorLanguage | undefined): Extension {
  if (lang === 'json') return json()
  if (lang === 'xml' || lang === 'html') return xml()
  return []
}

interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language?: EditorLanguage
  readOnly?: boolean
  /** Подсветка `{{var}}`, подсказки и автодополнение */
  variables?: boolean
  /** Однострочный режим: без переносов, Enter вызывает onEnter */
  singleLine?: boolean
  onEnter?: () => void
  /** Перехват вставки; вернуть true, если вставка обработана */
  onPaste?: (text: string) => boolean
  placeholder?: string
  ariaLabel: string
  /** Полный режим: номера строк, сворачивание, поиск */
  full?: boolean
  /** Минимум расширений — для очень больших ответов */
  plain?: boolean
  lineWrapping?: boolean
  className?: string
  onView?: (view: EditorView | null) => void
  testId?: string
}

export function CodeEditor(props: CodeEditorProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const langCompartment = useRef(new Compartment())
  const roCompartment = useRef(new Compartment())
  const hints = useData((s) => s.hints)

  // Редактор создаётся один раз; меняющиеся пропсы применяются через compartments/effects ниже
  useEffect(() => {
    const p = propsRef.current
    const keys: KeyBinding[] = []
    if (p.singleLine) {
      keys.push({
        key: 'Enter',
        run: () => {
          propsRef.current.onEnter?.()
          return true
        }
      })
    }
    const extensions: Extension[] = [
      editorTheme,
      editorHighlight,
      EditorView.contentAttributes.of({ 'aria-label': p.ariaLabel, ...(p.testId ? { 'data-testid': p.testId } : {}) }),
      langCompartment.current.of(languageExt(p.language)),
      roCompartment.current.of(EditorState.readOnly.of(!!p.readOnly)),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) propsRef.current.onChange?.(u.state.doc.toString())
      }),
      EditorView.domEventHandlers({
        paste(event) {
          const text = event.clipboardData?.getData('text/plain') ?? ''
          if (propsRef.current.onPaste?.(text)) {
            event.preventDefault()
            return true
          }
          return false
        }
      })
    ]
    if (p.placeholder) extensions.push(placeholderExt(p.placeholder))
    if (p.singleLine) {
      extensions.push(
        keymap.of([...keys, ...closeBracketsKeymap, ...completionKeymap]),
        // переводы строк при вставке превращаем в пробелы
        EditorState.transactionFilter.of((tr) => {
          if (!tr.docChanged || tr.newDoc.lines === 1) return tr
          const text = tr.newDoc.toString().replace(/\r?\n/g, ' ')
          return [tr, { changes: { from: 0, to: tr.newDoc.length, insert: text }, sequential: true }]
        }),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        drawSelection()
      )
    } else if (p.plain) {
      extensions.push(search({ top: true }), keymap.of([...searchKeymap, ...defaultKeymap]), lineNumbers())
    } else {
      extensions.push(
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        search({ top: true }),
        keymap.of([
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...searchKeymap,
          ...foldKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab
        ])
      )
      if (p.full) {
        extensions.push(lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), codeFolding(), foldGutter())
      }
    }
    if (p.lineWrapping) extensions.push(EditorView.lineWrapping)
    if (p.variables) extensions.push(variablesExtension(true))

    const v = new EditorView({
      parent: host.current as HTMLElement,
      state: EditorState.create({ doc: p.value, extensions })
    })
    if (p.variables) v.dispatch({ effects: setHints.of(useData.getState().hints) })
    view.current = v
    p.onView?.(v)
    return () => {
      propsRef.current.onView?.(null)
      v.destroy()
      view.current = null
    }
  }, [props.singleLine, props.full, props.plain, props.variables, props.lineWrapping])

  // Внешнее изменение значения (например, форматирование или смена вкладки)
  useEffect(() => {
    const v = view.current
    if (!v) return
    const cur = v.state.doc.toString()
    if (cur !== props.value) {
      v.dispatch({ changes: { from: 0, to: cur.length, insert: props.value } })
    }
  }, [props.value])

  useEffect(() => {
    view.current?.dispatch({ effects: langCompartment.current.reconfigure(languageExt(props.language)) })
  }, [props.language])

  useEffect(() => {
    view.current?.dispatch({
      effects: roCompartment.current.reconfigure(EditorState.readOnly.of(!!props.readOnly))
    })
  }, [props.readOnly])

  useEffect(() => {
    if (props.variables) view.current?.dispatch({ effects: setHints.of(hints) })
  }, [hints, props.variables])

  return <div ref={host} className={`code-editor ${props.singleLine ? 'single-line' : ''} ${props.className ?? ''}`} />
}
