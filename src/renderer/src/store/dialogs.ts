import { create } from 'zustand'
import type { RequestDraft } from '@shared/model'

export interface PromptRequest {
  kind: 'prompt'
  title: string
  label?: string
  initial?: string
  confirmText?: string
  multiline?: boolean
  resolve(value: string | null): void
}

export interface ConfirmRequest {
  kind: 'confirm'
  title: string
  message: string
  confirmText?: string
  danger?: boolean
  resolve(ok: boolean): void
}

export interface SaveAsRequest {
  kind: 'saveAs'
  draft: RequestDraft
  resolve(target: { collectionId: string; folderId: string | null; name: string } | null): void
}

export type DialogRequest = PromptRequest | ConfirmRequest | SaveAsRequest

interface DialogState {
  current: DialogRequest | null
  open(d: DialogRequest): void
  close(): void
}

export const useDialogs = create<DialogState>((set) => ({
  current: null,
  open: (current) => set({ current }),
  close: () => set({ current: null })
}))

export function promptDialog(opts: Omit<PromptRequest, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => useDialogs.getState().open({ kind: 'prompt', ...opts, resolve }))
}

export function confirmDialog(opts: Omit<ConfirmRequest, 'kind' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useDialogs.getState().open({ kind: 'confirm', ...opts, resolve }))
}

export function saveAsDialog(
  draft: RequestDraft
): Promise<{ collectionId: string; folderId: string | null; name: string } | null> {
  return new Promise((resolve) => useDialogs.getState().open({ kind: 'saveAs', draft, resolve }))
}
