const { useEffect } = require('react');

// 팝업(모달)이 열려있는 동안 ESC 키를 누르면 onClose를 호출해 닫아줍니다.
function useEscapeKey(onClose) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
}

module.exports = useEscapeKey;
