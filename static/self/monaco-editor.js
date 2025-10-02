require.config({
  paths: {
    vs: window.pathLib + "monaco-editor/0.53.0/vs",
    'vs/language/typescript/monaco.contribution': window.pathSelfLib + 'monaco-typescript-stub'
  }
});

window.onEditorLoaded = function (fn) {
  if (window.editorLoaded) {
    fn();
  } else {
    if (!window.editorLoadedHandles) window.editorLoadedHandles = [];
    window.editorLoadedHandles.push(fn);
  }
};

require(['vs/editor/editor.main'], function () {
  (function() {
      function autoLayout(editor) {
        window.addEventListener('resize', function () {
          editor.layout();
        });
      }

      $.getScript(window.pathSelfLib + "monaco-editor-tomorrow.js", function () {
        window.createCodeEditor = function (editorElement, langauge, content) {
          editorElement.innerHTML = '';
          var editor = monaco.editor.create(editorElement, {
            value: content,
            language: langauge,
            multicursorModifier: 'ctrlCmd',
            cursorWidth: 1,
            theme: 'tomorrow',
            lineHeight: 22,
            fontSize: 14,
            fontFamily: "'Fira Mono', 'Bitstream Vera Sans Mono', 'Menlo', 'Consolas', 'Lucida Console', 'Source Han Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft Yahei', monospace",
            lineNumbersMinChars: 4,
            glyphMargin: false,
            renderFinalNewline: true,
            scrollbar: {
              useShadows: false,
              verticalScrollbarSize: 0,
              vertical: 'hidden'
            },
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            contextmenu: false
          });

          autoLayout(editor);
          return editor;
        };

        window.createMarkdownEditor = function (wrapperElement, content, input) {
          wrapperElement.innerHTML = '';
          var editorElement = document.createElement('div');
          editorElement.classList.add('editor-wrapped');
          wrapperElement.appendChild(editorElement);
          var editor = monaco.editor.create(editorElement, {
            value: content,
            language: 'markdown',
            multicursorModifier: 'ctrlCmd',
            cursorWidth: 1,
            theme: 'tomorrow',
            fontSize: 14,
            fontFamily: "'Fira Mono', 'Source Han Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft Yahei', monospace",
            lineNumbersMinChars: 4,
            glyphMargin: false,
            lineNumbers: false,
            folding: false,
            minimap: {
              enabled: false
            },
            hover: {
              enabled: false
            },
            wordWrap: "on",
            renderIndentGuides: false,
            renderFinalNewline: false,
            wordBasedSuggestions: false,
            renderLineHighlight: false,
            occurrencesHighlight: false,
            scrollbar: {
              useShadows: false,
              vertical: 'auto',
              verticalScrollbarSize: 10
            },
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            contextmenu: false
          });

          input.form.addEventListener('submit', function () {
            input.value = editor.getValue();
          });

          autoLayout(editor);

          return editor;
        };

        window.editorLoaded = true;
        for (var i in window.editorLoadedHandles) {
          window.editorLoadedHandles[i]();
        }
      });
  })();
});
