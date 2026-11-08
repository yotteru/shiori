import { describe, expect, it } from 'vitest';
import { focusMinutes, focusShortcutUrl } from './shortcut';

describe('集中モードのショートカット', () => {
  it('計画の行き先は予定の長さ、その場の5分は60分。5分より短くしない', () => {
    expect(focusMinutes(90)).toBe(90);
    expect(focusMinutes(undefined)).toBe(60);
    expect(focusMinutes(1)).toBe(5);
  });
  it('分数を数字だけの文字として渡す', () => {
    const u = new URL(focusShortcutUrl(45).replace('shortcuts://', 'https://x/'));
    expect(u.searchParams.get('name')).toBe('しおり5分');
    expect(u.searchParams.get('input')).toBe('text');
    expect(u.searchParams.get('text')).toBe('45');
  });
});
