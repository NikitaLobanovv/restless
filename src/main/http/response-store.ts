/** LRU полных тел ответов — для «Сохранить в файл» и «Копировать» без пересылки в renderer */
export class ResponseStore {
  private readonly items = new Map<string, { body: Buffer; contentType: string }>()
  private total = 0

  constructor(
    private readonly maxItems: number,
    private readonly maxBytes: number
  ) {}

  put(id: string, body: Buffer, contentType: string): void {
    this.items.set(id, { body, contentType })
    this.total += body.length
    while (this.items.size > this.maxItems || (this.total > this.maxBytes && this.items.size > 1)) {
      const oldest = this.items.keys().next().value as string
      this.total -= this.items.get(oldest)?.body.length ?? 0
      this.items.delete(oldest)
    }
  }

  get(id: string): { body: Buffer; contentType: string } | undefined {
    const item = this.items.get(id)
    if (item) {
      // освежаем позицию в LRU
      this.items.delete(id)
      this.items.set(id, item)
    }
    return item
  }

  get size(): number {
    return this.items.size
  }
}
