import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { emptyDraft, type CollectionNode, type FolderNode, type RequestSummary } from '@shared/model'
import { api } from '../../api'
import { confirmDialog, promptDialog } from '../../store/dialogs'
import { findFolder, useData } from '../../store/data'
import { useTabs } from '../../store/tabs'
import { useUi } from '../../store/ui'
import { Icon } from '../Icon'

type NodeKind = 'collection' | 'folder' | 'request'

interface FlatNode {
  key: string
  kind: NodeKind
  id: string
  name: string
  level: number
  collectionId: string
  /** Для запроса — папка-контейнер, для папки — родитель */
  parentFolderId: string | null
  method?: string
  url?: string
  hasChildren: boolean
  index: number
}

const DND_TYPE = 'application/x-restless-node'

function matches(q: string, r: RequestSummary): boolean {
  return r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q)
}

function folderHasMatch(f: FolderNode, q: string): boolean {
  return (
    f.name.toLowerCase().includes(q) ||
    f.requests.some((r) => matches(q, r)) ||
    f.folders.some((sub) => folderHasMatch(sub, q))
  )
}

function collectRequestIds(folders: FolderNode[], requests: RequestSummary[]): string[] {
  return [...requests.map((r) => r.id), ...folders.flatMap((f) => collectRequestIds(f.folders, f.requests))]
}

/**
 * Плоский список видимых узлов — для отрисовки и навигации стрелками.
 * `toggled`: коллекции раскрыты по умолчанию (в наборе — свёрнутые), папки наоборот.
 */
function flatten(tree: CollectionNode[], toggled: Set<string>, query: string): FlatNode[] {
  const q = query.trim().toLowerCase()
  const out: FlatNode[] = []
  const addContainer = (
    collectionId: string,
    folders: FolderNode[],
    requests: RequestSummary[],
    level: number
  ): void => {
    folders.forEach((f, index) => {
      if (q && !folderHasMatch(f, q)) return
      const open = q ? true : toggled.has(f.id)
      out.push({
        key: `f:${f.id}`,
        kind: 'folder',
        id: f.id,
        name: f.name,
        level,
        collectionId,
        parentFolderId: f.parentId,
        hasChildren: f.folders.length + f.requests.length > 0,
        index
      })
      if (open) addContainer(collectionId, f.folders, f.requests, level + 1)
    })
    requests.forEach((r, index) => {
      if (q && !matches(q, r)) return
      out.push({
        key: `r:${r.id}`,
        kind: 'request',
        id: r.id,
        name: r.name,
        level,
        collectionId,
        parentFolderId: r.folderId,
        method: r.method,
        url: r.url,
        hasChildren: false,
        index
      })
    })
  }
  for (const c of tree) {
    const childMatch = !q || c.folders.some((f) => folderHasMatch(f, q)) || c.requests.some((r) => matches(q, r))
    if (!childMatch && !c.name.toLowerCase().includes(q)) continue
    out.push({
      key: `c:${c.id}`,
      kind: 'collection',
      id: c.id,
      name: c.name,
      level: 1,
      collectionId: c.id,
      parentFolderId: null,
      hasChildren: c.folders.length + c.requests.length > 0,
      index: 0
    })
    if (q || !toggled.has(c.id)) addContainer(c.id, c.folders, c.requests, 2)
  }
  return out
}

export function CollectionTree({ query }: { query: string }): React.JSX.Element {
  const { t } = useTranslation()
  const tree = useData((s) => s.tree)
  const loadTree = useData((s) => s.loadTree)
  const fail = useUi((s) => s.fail)
  const openVariables = useUi((s) => s.openVariables)
  const activeRequestId = useTabs((s) => s.tabs.find((x) => x.id === s.activeId)?.requestId ?? null)
  const [toggled, setToggled] = useState<Set<string>>(() => new Set())
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const itemRefs = useRef(new Map<string, HTMLDivElement>())

  const nodes = useMemo(() => flatten(tree, toggled, query), [tree, toggled, query])
  const collectionIds = useMemo(() => new Set(tree.map((c) => c.id)), [tree])
  const isOpen = (kind: NodeKind, id: string): boolean => {
    if (kind === 'request') return false
    if (query) return true
    return kind === 'collection' ? !toggled.has(id) : toggled.has(id)
  }
  const currentFocus = nodes.find((n) => n.key === focusKey)?.key ?? nodes[0]?.key ?? null

  const toggle = (id: string, open?: boolean): void => {
    setToggled((prev) => {
      const next = new Set(prev)
      const isCollection = collectionIds.has(id)
      const currentlyOpen = isCollection ? !next.has(id) : next.has(id)
      const shouldOpen = open ?? !currentlyOpen
      // для коллекции «в наборе» = свёрнута, для папки = раскрыта
      if (shouldOpen === !isCollection) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
      await loadTree()
    } catch (err) {
      fail(err)
    }
  }

  const openRequest = async (id: string): Promise<void> => {
    try {
      const saved = await api.requests.get({ id })
      if (saved) useTabs.getState().openSaved(saved)
    } catch (err) {
      fail(err)
    }
  }

  const newRequest = (collectionId: string, folderId: string | null): Promise<void> =>
    run(async () => {
      const saved = await api.requests.save({
        collectionId,
        folderId,
        draft: { ...emptyDraft(), name: t('request.newName') }
      })
      if (folderId) toggle(folderId, true)
      toggle(collectionId, true)
      useTabs.getState().openSaved(saved)
    })

  const newFolder = async (collectionId: string, parentId: string | null): Promise<void> => {
    const name = await promptDialog({
      title: t('collections.newFolder'),
      label: t('common.name'),
      initial: t('collections.folderDefault')
    })
    if (!name) return
    await run(async () => {
      const { id } = await api.folders.create({ collectionId, parentId, name })
      toggle(collectionId, true)
      if (parentId) toggle(parentId, true)
      toggle(id, true)
    })
  }

  const rename = async (node: FlatNode): Promise<void> => {
    const name = await promptDialog({ title: t('common.rename'), label: t('common.name'), initial: node.name })
    if (!name || name === node.name) return
    await run(async () => {
      if (node.kind === 'collection') await api.collections.rename({ id: node.id, name })
      else if (node.kind === 'folder') await api.folders.rename({ id: node.id, name })
      else {
        await api.requests.rename({ id: node.id, name })
        useTabs.getState().onRequestRenamed(node.id, name)
      }
    })
  }

  const remove = async (node: FlatNode): Promise<void> => {
    const ok = await confirmDialog({
      title: t('common.delete'),
      message: t(`collections.confirmDelete.${node.kind}`, { name: node.name }),
      confirmText: t('common.delete'),
      danger: true
    })
    if (!ok) return
    let requestIds: string[] = [node.id]
    if (node.kind === 'collection') {
      const c = tree.find((x) => x.id === node.id)
      requestIds = c ? collectRequestIds(c.folders, c.requests) : []
    } else if (node.kind === 'folder') {
      const f = findFolder(tree, node.id)
      requestIds = f ? collectRequestIds(f.folders, f.requests) : []
    }
    await run(async () => {
      if (node.kind === 'collection') await api.collections.delete({ id: node.id })
      else if (node.kind === 'folder') await api.folders.delete({ id: node.id })
      else await api.requests.delete({ id: node.id })
      useTabs.getState().onRequestsDeleted(requestIds)
    })
  }

  const duplicate = (node: FlatNode): Promise<void> =>
    run(async () => {
      const copy = await api.requests.duplicate({ id: node.id })
      await openRequest(copy.id)
    })

  const showMenu = async (node: FlatNode): Promise<void> => {
    const items =
      node.kind === 'request'
        ? [
            { id: 'open', label: t('collections.open') },
            { id: 'duplicate', label: t('collections.duplicate') },
            { id: 'rename', label: t('common.rename') },
            { id: 'sep', label: '', type: 'separator' as const },
            { id: 'delete', label: t('common.delete') }
          ]
        : [
            { id: 'newRequest', label: t('collections.newRequest') },
            { id: 'newFolder', label: t('collections.newFolder') },
            ...(node.kind === 'collection' ? [{ id: 'variables', label: t('collections.variables') }] : []),
            { id: 'rename', label: t('common.rename') },
            { id: 'sep', label: '', type: 'separator' as const },
            { id: 'delete', label: t('common.delete') }
          ]
    const choice = await api.menu.popup({ items })
    const folderId = node.kind === 'folder' ? node.id : null
    switch (choice) {
      case 'open':
        return openRequest(node.id)
      case 'duplicate':
        return duplicate(node)
      case 'rename':
        return rename(node)
      case 'delete':
        return remove(node)
      case 'newRequest':
        return newRequest(node.collectionId, folderId)
      case 'newFolder':
        return newFolder(node.collectionId, folderId)
      case 'variables':
        openVariables({ scope: 'collection', scopeId: node.id })
        return
      default:
        return
    }
  }

  const activate = (node: FlatNode): void => {
    if (node.kind === 'request') void openRequest(node.id)
    else toggle(node.id)
  }

  const focusNode = (key: string | undefined): void => {
    if (!key) return
    setFocusKey(key)
    itemRefs.current.get(key)?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent, node: FlatNode, i: number): void => {
    const open = isOpen(node.kind, node.id)
    switch (e.key) {
      case 'ArrowDown':
        focusNode(nodes[i + 1]?.key)
        break
      case 'ArrowUp':
        focusNode(nodes[i - 1]?.key)
        break
      case 'Home':
        focusNode(nodes[0]?.key)
        break
      case 'End':
        focusNode(nodes[nodes.length - 1]?.key)
        break
      case 'ArrowRight':
        if (node.kind !== 'request' && !open) toggle(node.id, true)
        else if (open) focusNode(nodes[i + 1]?.key)
        break
      case 'ArrowLeft':
        if (open) toggle(node.id, false)
        else {
          for (let j = i - 1; j >= 0; j--) {
            if (nodes[j].level < node.level) {
              focusNode(nodes[j].key)
              break
            }
          }
        }
        break
      case 'Enter':
      case ' ':
        activate(node)
        break
      case 'F2':
        void rename(node)
        break
      case 'Delete':
        void remove(node)
        break
      case 'ContextMenu':
        void showMenu(node)
        break
      default:
        if (e.key === 'F10' && e.shiftKey) void showMenu(node)
        else return
    }
    e.preventDefault()
  }

  /* ---------- Drag and drop ---------- */

  const onDragStart = (e: React.DragEvent, node: FlatNode): void => {
    if (node.kind === 'collection') {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: node.kind, id: node.id }))
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDrop = async (e: React.DragEvent, target: FlatNode): Promise<void> => {
    e.preventDefault()
    setDropKey(null)
    const raw = e.dataTransfer.getData(DND_TYPE)
    if (!raw) return
    const src = JSON.parse(raw) as { kind: 'folder' | 'request'; id: string }
    if (src.id === target.id) return
    await run(async () => {
      if (src.kind === 'request') {
        if (target.kind === 'request') {
          // перед целевым запросом, в его контейнере
          await api.requests.move({
            id: src.id,
            collectionId: target.collectionId,
            folderId: target.parentFolderId,
            index: target.index
          })
        } else {
          await api.requests.move({
            id: src.id,
            collectionId: target.collectionId,
            folderId: target.kind === 'folder' ? target.id : null,
            index: 1_000_000
          })
          toggle(target.id, true)
        }
        const moved = useTabs.getState().tabs.find((x) => x.requestId === src.id)
        if (moved && moved.collectionId !== target.collectionId) {
          // переменные коллекции меняются вместе с местом запроса
          useTabs.setState({
            tabs: useTabs
              .getState()
              .tabs.map((x) => (x.id === moved.id ? { ...x, collectionId: target.collectionId } : x))
          })
        }
      } else {
        const parentId = target.kind === 'folder' ? target.id : target.kind === 'request' ? target.parentFolderId : null
        await api.folders.move({ id: src.id, collectionId: target.collectionId, parentId, index: 1_000_000 })
        if (parentId) toggle(parentId, true)
      }
    })
  }

  if (tree.length === 0) {
    return (
      <div className="empty-state small">
        <Icon name="collection" size={32} />
        <p className="empty-title">{t('collections.emptyTitle')}</p>
        <p className="muted">{t('collections.emptyHint')}</p>
      </div>
    )
  }
  if (nodes.length === 0) return <p className="empty-hint">{t('common.nothingFound')}</p>

  return (
    <div className="tree" role="tree" aria-label={t('sidebar.collections')} data-testid="collection-tree">
      {nodes.map((node, i) => {
        const open = isOpen(node.kind, node.id)
        return (
          <div
            key={node.key}
            ref={(el) => {
              if (el) itemRefs.current.set(node.key, el)
              else itemRefs.current.delete(node.key)
            }}
            role="treeitem"
            aria-level={node.level}
            aria-expanded={node.kind === 'request' ? undefined : open}
            aria-selected={node.kind === 'request' && node.id === activeRequestId}
            tabIndex={node.key === currentFocus ? 0 : -1}
            className={`tree-item tree-${node.kind} ${node.id === activeRequestId ? 'active' : ''} ${dropKey === node.key ? 'drop-target' : ''}`}
            style={{ paddingLeft: `${(node.level - 1) * 14 + 6}px` }}
            draggable={node.kind !== 'collection'}
            onDragStart={(e) => onDragStart(e, node)}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DND_TYPE)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDropKey(node.key)
            }}
            onDragLeave={() => setDropKey((k) => (k === node.key ? null : k))}
            onDrop={(e) => void onDrop(e, node)}
            onClick={() => {
              setFocusKey(node.key)
              activate(node)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setFocusKey(node.key)
              void showMenu(node)
            }}
            onKeyDown={(e) => onKeyDown(e, node, i)}
            onFocus={() => setFocusKey(node.key)}
            title={node.kind === 'request' ? `${node.method} ${node.url}` : node.name}
            data-testid={`tree-${node.kind}`}
          >
            {node.kind === 'request' ? (
              <span className={`method-badge method-${node.method?.toLowerCase()}`}>{node.method}</span>
            ) : (
              <span className="tree-chevron" aria-hidden="true">
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
              </span>
            )}
            {node.kind === 'folder' && <Icon name="folder" size={14} />}
            {node.kind === 'collection' && <Icon name="collection" size={14} />}
            <span className="tree-name">{node.name}</span>
            <button
              type="button"
              className="icon-btn tree-more"
              tabIndex={-1}
              aria-label={t('common.actions')}
              onClick={(e) => {
                e.stopPropagation()
                void showMenu(node)
              }}
            >
              <Icon name="more" size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
