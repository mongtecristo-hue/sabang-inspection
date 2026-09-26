import { useEffect, useRef } from 'react';

/* ---------- 안드로이드 뒤로가기: 열린 화면을 하나씩 닫는다 ----------
   화면 하나가 열릴 때 기록(history) 항목 하나를 쌓는다. 뒤로가기로 닫히면 그 항목이 소비되고,
   화면 버튼으로 닫히면 history.back()으로 항목을 직접 소비해 둘의 개수를 항상 맞춘다. */
const backStack = [];
let ignorePops = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) { ignorePops -= 1; return; }
    const top = backStack.pop();
    if (top) { top.popped = true; top.fn(); }
  });
}
export const useBackHandler = (active, onBack) => {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return undefined;
    const entry = { fn: () => ref.current(), popped: false };
    backStack.push(entry);
    history.pushState({ dm: backStack.length }, '');
    return () => {
      const i = backStack.indexOf(entry);
      if (i >= 0) backStack.splice(i, 1);
      if (!entry.popped) { ignorePops += 1; history.back(); }
    };
  }, [active]);
};
