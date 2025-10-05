(function(){
  function createTextAreaEditor(element, lang, content) {
    element.innerHTML = '';
    var ta = document.createElement('textarea');
    ta.style.width = '100%';
    ta.style.height = '100%';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.resize = 'none';
    ta.value = content || '';
    element.appendChild(ta);

    var editor = {
      getValue: function(){ return ta.value; },
      getModel: function(){ return null; },
      getDomNode: function(){ return element; },
      getSelection: function(){
        return {
          startLineNumber: 1,
          startColumn: ta.selectionStart + 1,
          endLineNumber: 1,
          endColumn: ta.selectionEnd + 1
        };
      },
      executeEdits: function(_src, edits){
        if (!edits || !edits.length) return;
        var e = edits[0];
        var start = Math.min(ta.selectionStart, ta.selectionEnd);
        var end = Math.max(ta.selectionStart, ta.selectionEnd);
        var before = ta.value.slice(0, start);
        var after = ta.value.slice(end);
        ta.value = before + (e.text || '') + after;
        var pos = (before + (e.text || '')).length;
        ta.selectionStart = ta.selectionEnd = pos;
      },
      layout: function(){},
      setValue: function(v){ ta.value = v; },
      focus: function(){ ta.focus(); }
    };

    // basic clipboard works natively on textarea
    return editor;
  }

  window.onEditorLoaded = function (fn) { fn(); };
  window.createCodeEditor = function (el, lang, content) { return createTextAreaEditor(el, lang, content); };
})();
