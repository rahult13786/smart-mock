import { createContext, useContext } from 'react';

/** Shared editing context for the detail page: { draft, setAt(path, value), open(path) } */
export const EditorContext = createContext(null);
export const useEditor = () => useContext(EditorContext);
