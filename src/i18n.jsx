import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const messages = {
  es: {
    tileset: 'Tileset', assets: 'Assets', levels: 'Niveles', light: 'Día', dark: 'Noche', grid: 'Cuadrícula', signOut: 'Cerrar sesión',
    save: 'Guardar', saveLevel: 'Guardar nivel', playtest: 'Probar', exitPlaytest: 'Salir de prueba', export: 'Exportar', undo: 'Deshacer', redo: 'Rehacer',
    terrain: 'Terreno', props: 'Props', select: 'Seleccionar', all: 'Todos', favorites: 'Favoritos', recent: 'Recientes', collections: 'Todas las colecciones',
    tilesets: 'Tilesets', stamps: 'Stamps', search: 'Buscar por nombre, tamaño, tipo o etiqueta…', apply: 'Aplicar', cancel: 'Cancelar',
    delete: 'Eliminar', editMeta: 'Editar categoría y etiquetas', addFavorite: 'Añadir a favoritos', removeFavorite: 'Quitar de favoritos',
    layers: 'Capas', activeTool: 'Herramienta activa', terrainOptions: 'Opciones de terreno', selection: 'Selección',
    brush: 'Pincel', fill: 'Rellenar', eraser: 'Borrador', picker: 'Cuentagotas', rectangle: 'Rectángulo',
    saved: 'Guardado', unsavedChanges: 'Cambios sin guardar', lastSave: 'Último guardado', layer: 'Capa', noLayer: 'Sin capa',
    fit: 'Ajustar', zoomSelection: 'Selección', addMarker: 'Marcador', panHint: 'Mantén Espacio y arrastra para desplazarte',
    mapSettings: 'Configuración del mapa', generate: 'Generar', aiIdeas: 'Ideas con IA', manualActions: 'Acciones manuales', recovery: 'Proyectos y recuperación',
    allVisible: 'Todas visibles', none: 'Ninguna', includeProps: 'Incluir props', object: 'Objeto', area: 'Área', overlay: 'Superponer', replace: 'Reemplazar',
    moreSaveOptions: 'Más opciones de guardado', saveAsNew: 'Guardar como nuevo', exportProject: 'Exportar', language: 'Idioma',
    tools: 'Herramientas', color: 'Color', assetSize: 'Tamaño del asset', generateAI: 'Generar con IA', brushSize: 'Tamaño del pincel',
    clear: 'Limpiar', saveGallery: 'Guardar en biblioteca', gallery: 'Biblioteca', edit: 'Editar', mode: 'Modo', draw: 'Dibujar', procedural: 'Procedural',
    generatorSettings: 'Configuración del generador', presetLibrary: 'Biblioteca de presets', shuffle: 'Mezclar', reset: 'Restablecer', drawTools: 'Herramientas de dibujo',
    tilingGuide: 'Guía de mosaico', aiGenerator: 'Generador IA', preview: 'Vista previa',
    signIn: 'Iniciar sesión', createAccount: 'Crear cuenta', resetPassword: 'Restablecer contraseña', sendResetEmail: 'Enviar correo',
    password: 'Contraseña', working: 'Procesando…', forgotPassword: '¿Olvidaste tu contraseña?', setNewPassword: 'Define una contraseña nueva', newPassword: 'Nueva contraseña', savePassword: 'Guardar contraseña',
    biomes: 'Biomas', ground: 'Terreno', manual: 'Manual', autotile: 'Autotile', collision: 'Colisión', hideLayer: 'Ocultar capa', showLayer: 'Mostrar capa', lockLayer: 'Bloquear capa', unlockLayer: 'Desbloquear capa', renameLayer: 'Renombrar capa', soloLayer: 'Aislar capa',
  },
  en: {
    tileset: 'Tileset', assets: 'Assets', levels: 'Levels', light: 'Light', dark: 'Dark', grid: 'Grid', signOut: 'Sign out',
    save: 'Save', saveLevel: 'Save level', playtest: 'Playtest', exitPlaytest: 'Exit playtest', export: 'Export', undo: 'Undo', redo: 'Redo',
    terrain: 'Terrain', props: 'Props', select: 'Select', all: 'All', favorites: 'Favorites', recent: 'Recent', collections: 'All collections',
    tilesets: 'Tilesets', stamps: 'Stamps', search: 'Search by name, size, type, or tag…', apply: 'Apply', cancel: 'Cancel',
    delete: 'Delete', editMeta: 'Edit category and tags', addFavorite: 'Add favorite', removeFavorite: 'Remove favorite',
    layers: 'Layers', activeTool: 'Active tool', terrainOptions: 'Terrain options', selection: 'Selection',
    brush: 'Brush', fill: 'Fill', eraser: 'Eraser', picker: 'Picker', rectangle: 'Rectangle',
    saved: 'Saved', unsavedChanges: 'Unsaved changes', lastSave: 'Last save', layer: 'Layer', noLayer: 'No layer',
    fit: 'Fit', zoomSelection: 'Selection', addMarker: 'Marker', panHint: 'Hold Space and drag to pan',
    mapSettings: 'Map settings', generate: 'Generate', aiIdeas: 'AI ideas', manualActions: 'Manual actions', recovery: 'Projects & recovery',
    allVisible: 'All visible', none: 'None', includeProps: 'Include props', object: 'Object', area: 'Area', overlay: 'Overlay', replace: 'Replace',
    moreSaveOptions: 'More save options', saveAsNew: 'Save as new', exportProject: 'Export', language: 'Language',
    tools: 'Tools', color: 'Color', assetSize: 'Asset size', generateAI: 'Generate with AI', brushSize: 'Brush size',
    clear: 'Clear', saveGallery: 'Save to library', gallery: 'Library', edit: 'Edit', mode: 'Mode', draw: 'Draw', procedural: 'Procedural',
    generatorSettings: 'Generator settings', presetLibrary: 'Preset library', shuffle: 'Shuffle', reset: 'Reset', drawTools: 'Draw tools',
    tilingGuide: 'Tiling guide', aiGenerator: 'AI generator', preview: 'Preview',
    signIn: 'Sign in', createAccount: 'Create account', resetPassword: 'Reset password', sendResetEmail: 'Send reset email',
    password: 'Password', working: 'Working…', forgotPassword: 'Forgot password?', setNewPassword: 'Set a new password', newPassword: 'New password', savePassword: 'Save password',
    biomes: 'Biomes', ground: 'Ground', manual: 'Manual', autotile: 'Autotile', collision: 'Collision', hideLayer: 'Hide layer', showLayer: 'Show layer', lockLayer: 'Lock layer', unlockLayer: 'Unlock layer', renameLayer: 'Rename layer', soloLayer: 'Solo layer',
  },
}

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    try { return localStorage.getItem('ts.language') || 'es' } catch { return 'es' }
  })
  const value = useMemo(() => ({
    language,
    setLanguage(next) {
      setLanguageState(next)
      try { localStorage.setItem('ts.language', next) } catch { /* optional */ }
      document.documentElement.lang = next
    },
    t(key) { return messages[language]?.[key] || messages.en[key] || key },
  }), [language])
  useEffect(() => { document.documentElement.lang = language }, [language])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext) || { language: 'es', setLanguage() {}, t: key => messages.es[key] || key }
}
