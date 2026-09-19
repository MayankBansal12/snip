import { useEffect, useRef } from 'react';
import type { Tool } from '../types';

export type ShortcutActions = {
  hasVideo: boolean; blocked: boolean;
  play: () => void; seekBy: (seconds: number) => void; seekEdge: (end: boolean) => void;
  seekCut: (direction: number) => void; split: () => void; remove: () => void;
  trim: (edge: 'start' | 'end') => void; undo: () => void; redo: () => void;
  mute: () => void; speed: (direction: number) => void; zoom: (direction: number) => void;
  tool: (tool: Tool) => void; expand: () => void; open: () => void; export: () => void;
  openProject: () => void; saveProject: () => void; help: () => void; escape: () => void;
};
export function useEditorShortcuts(actions: ShortcutActions) {
  const latest = useRef(actions); latest.current = actions;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const a = latest.current, target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.isComposing || event.altKey || a.blocked || document.querySelector('dialog[open]')) return;
      // Text editing and native selects keep their own shortcuts and undo history.
      if (target?.closest('textarea,select,input:not([type=range]):not([type=checkbox]):not([type=radio]),[contenteditable]:not([contenteditable="false"])')) return;
      const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
      let run: (() => void) | undefined;
      if (mod) {
        if (key === 'o') run = event.shiftKey ? a.openProject : a.open;
        if (a.hasVideo) {
          if (key === 's' && !event.shiftKey) run = a.saveProject;
          if (key === 'e' && !event.shiftKey) run = a.export;
          if (key === 'z') run = event.shiftKey ? a.redo : a.undo;
          if (key === 'y' && !event.shiftKey) run = a.redo;
        }
      } else if (key === '?') run = a.help;
      else if (a.hasVideo) {
        const nativeNavigation = target?.closest('input,[role=slider],button,summary,a');
        if (key === 'k' || (key === ' ' && !target?.closest('button,summary,a,[role=button],input[type=checkbox],input[type=radio]'))) run = a.play;
        if (!nativeNavigation) {
          if (key === 'arrowleft' || key === 'arrowright') run = () => a.seekBy((key === 'arrowright' ? 1 : -1) * (event.shiftKey ? 1 : 1 / 30));
          if (key === 'arrowup' || key === 'arrowdown') run = () => a.seekCut(key === 'arrowdown' ? 1 : -1);
          if (key === 'home' || key === 'end') run = () => a.seekEdge(key === 'end');
        }
        if (!event.shiftKey) {
          if (key === 's') run = a.split;
          if (key === 'i' || key === 'o') run = () => a.trim(key === 'i' ? 'start' : 'end');
          if (key === 'm') run = a.mute;
          if (key === 'f') run = a.expand;
          if (key === '[' || key === ']') run = () => a.speed(key === ']' ? 1 : -1);
          if (/^[1-5]$/.test(key)) run = () => a.tool((['canvas', 'crop', 'filters', 'annotate', 'speed'] as Tool[])[Number(key) - 1]);
        }
        if (key === '+' || key === '=' || key === '-') run = () => a.zoom(key === '-' ? -1 : 1);
        if (key === 'delete' || key === 'backspace') run = a.remove;
        if (key === 'escape') run = a.escape;
      }
      if (!run) return;
      event.preventDefault();
      if (event.repeat && !['arrowleft', 'arrowright', '+', '=', '-'].includes(key)) return;
      run();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
}
