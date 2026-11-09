import {useCallback,useEffect} from 'react';
import {App} from 'antd';

const changes = new Set();
let confirming = false;
let leaving = false;

export function hasLegacyChanges() {
  return changes.size > 0;
}

export function leaveLegacyPage(url) {
  leaving = true;
  window.location.assign(url);
}

function beforeUnload(event) {
  if (!leaving && hasLegacyChanges()) {
    event.preventDefault();
    event.returnValue = '';
  }
}

function notifyParent(key, open) {
  window.parent.postMessage(
    {type: 'aroma:form-lock', key, open},
    'http://127.0.0.1:8791',
  );
}

export function useLegacyNavigationLock(key, active) {
  const release = useCallback(() => {
    if (!changes.delete(key)) return;
    if (window.parent !== window) notifyParent(key, false);
    else if (!hasLegacyChanges()) window.removeEventListener('beforeunload', beforeUnload);
  }, [key]);

  useEffect(() => {
    if (!active) return;
    changes.add(key);
    if (window.parent !== window) notifyParent(key, true);
    else window.addEventListener('beforeunload', beforeUnload);
    return release;
  }, [key, active, release]);
  return release;
}

export function useLegacyDiscard() {
  const {modal} = App.useApp();
  return (dirty, leave, explicitClose = false) => {
    if (!dirty && !explicitClose) {
      leave();
      return;
    }
    if (confirming) return;
    confirming = true;
    modal.confirm({
      title: dirty ? 'Выйти без сохранения?' : 'Закрыть форму?',
      content: dirty ? 'В текущей форме есть несохранённые изменения.' : undefined,
      okText: 'Выйти',
      cancelText: 'Продолжить работу',
      autoFocusButton: 'cancel',
      zIndex: 2000,
      onOk: leave,
      afterClose: () => { confirming = false; },
    });
  };
}
