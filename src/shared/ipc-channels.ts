import type { Language, ThemeSource } from './model'

export const CHANNELS = [
  'app:info',
  'config:get',
  'config:set',
  'db:status',
  'db:connect',
  'db:retry',
  'http:send',
  'http:cancel',
  'http:saveBody',
  'http:copyBody',
  'collections:tree',
  'collections:create',
  'collections:rename',
  'collections:delete',
  'folders:create',
  'folders:rename',
  'folders:delete',
  'folders:move',
  'requests:get',
  'requests:save',
  'requests:rename',
  'requests:delete',
  'requests:duplicate',
  'requests:move',
  'requests:search',
  'environments:list',
  'environments:create',
  'environments:rename',
  'environments:delete',
  'environments:setActive',
  'variables:list',
  'variables:save',
  'variables:hints',
  'history:list',
  'history:get',
  'history:delete',
  'history:clear',
  'tabs:load',
  'tabs:save',
  'curl:copy',
  'files:pick',
  'files:saveText',
  'menu:popup'
] as const

export type Channel = (typeof CHANNELS)[number]

export const EVENTS = ['menu:action', 'config:changed', 'app:beforeQuit'] as const
export type AppEvent = (typeof EVENTS)[number]

export const MENU_ACTIONS = [
  'newRequest',
  'save',
  'closeTab',
  'nextTab',
  'prevTab',
  'quickSearch',
  'formatBody',
  'switchEnv',
  'send',
  'importCurl',
  'copyCurl',
  'toggleSidebar',
  'toggleLayout',
  'editVariables'
] as const
export type MenuAction = (typeof MENU_ACTIONS)[number] | `theme:${ThemeSource}` | `language:${Language}`
