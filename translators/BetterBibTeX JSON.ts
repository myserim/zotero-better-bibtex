declare const Translator: ITranslator

declare const Zotero: any

import { debug } from './lib/debug.ts'

const chunkSize = 0x100000

Translator.detectImport = () => {
  let str
  debug('BetterBibTeX JSON.detect: start')
  let json = ''
  while ((str = Zotero.read(chunkSize)) !== false) {
    json += str
    if (json[0] !== '{') return false
  }

  // a failure to parse will throw an error which a) is actually logged, and b) will count as "false"
  const data = JSON.parse(json)

  if (!data.config || (data.config.id !== Translator.header.translatorID)) throw new Error(`ID mismatch: got ${data.config && data.config.id}, expected ${Translator.header.translatorID}`)
  if (!data.items || !data.items.length) throw new Error('No items')
  return true
}

Translator.doImport = () => {
  let str
  let json = ''
  while ((str = Zotero.read(chunkSize)) !== false) {
    json += str
  }

  const data = JSON.parse(json)
  const validFields = Zotero.BetterBibTeX.validFields()

  const items = new Set
  for (const source of (data.items as any[])) {
    if (!validFields[source.itemType]) throw new Error(`unexpected item type '${source.itemType}'`)
    for (const field of Object.keys(source)) {
      if (!validFields[source.itemType][field]) throw new Error(`unexpected ${source.itemType}.${field}`)
    }

    const item = new Zotero.Item()
    Object.assign(item, source)
    for (const att of item.attachments || []) {
      if (att.url) delete att.path
    }
    item.complete()
    items.add(source.itemID)
  }

  const collections: any[] = Object.values(data.collections || {})
  for (const collection of collections) {
    collection.zoteroCollection = (new Zotero.Collection()) as any
    collection.zoteroCollection.type = 'collection'
    collection.zoteroCollection.name = collection.name
    collection.zoteroCollection.children = collection.items.filter(id => {
      if (items.has(id)) return true
      debug(`Collection ${collection.key} has non-existent item ${id}`)
      return false
    }).map(id => ({type: 'item', id}))
  }
  for (const collection of collections) {
    if (collection.parent && data.collections[collection.parent]) {
      data.collections[collection.parent].zoteroCollection.children.push(collection.zoteroCollection)
    } else {
      if (collection.parent) debug(`Collection ${collection.key} has non-existent parent ${collection.parent}`)
      collection.parent = false
    }
  }
  for (const collection of collections) {
    if (collection.parent) continue
    collection.zoteroCollection.complete()
  }
}

Translator.doExport = () => {
  let item
  debug('starting export')
  const data = {
    config: {
      id: Translator.header.translatorID,
      label: Translator.header.label,
      release: Zotero.BetterBibTeX.version(),
      preferences: Translator.preferences,
      options: Translator.options,
    },
    collections: Translator.collections,
    items: [],
  }
  debug('header ready')

  const validFields = Zotero.BetterBibTeX.validFields()
  const validAttachmentFields = new Set([ 'itemType', 'title', 'path', 'tags', 'dateAdded', 'dateModified', 'seeAlso', 'mimeType' ])

  while ((item = Zotero.nextItem())) {
    for (const field of Object.keys(item)) {
      if (validFields[item.itemType] && !validFields[item.itemType][field]) {
        delete item[field]
      }
    }

    for (const att of item.attachments || []) {
      att.path = att.localpath
      for (const field of Object.keys(att)) {
        if (!validAttachmentFields.has(field)) delete att[field]
      }
    }

    debug('adding item', item.itemID)
    data.items.push(item)
  }
  debug('data ready')

  Zotero.write(JSON.stringify(data, null, '  '))
  debug('export done')
}
