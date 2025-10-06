(function(){
  var queuedCallbacks = [];
  var isReady = false;
  var simpleCreate = window.createCodeEditor;

  function normalizeBase(base) {
    var b = base || '';
    if (!b) return window.location.origin;
    if (b.slice(0, 2) === '//') return window.location.protocol + b;
    if (/^https?:\/\//i.test(b)) return b;
    if (b[0] === '/') return window.location.origin + b;
    return window.location.origin + '/' + b;
  }

  window.onEditorLoaded = function (fn) {
    if (isReady) return fn();
    queuedCallbacks.push(fn);
  };

  function flushReady() {
    isReady = true;
    for (var i = 0; i < queuedCallbacks.length; i++) {
      try { queuedCallbacks[i](); } catch (e) {}
    }
    queuedCallbacks = [];
  }

  function mapLanguage(lang) {
    if (!lang) return 'plaintext';
    var m = {
      c: 'c_cpp',
      cpp: 'c_cpp',
      'c++': 'c_cpp',
      csharp: 'csharp',
      pascal: 'pascal',
      python: 'python',
      py: 'python',
      java: 'java',
      javascript: 'javascript',
      js: 'javascript',
      typescript: 'typescript',
      ts: 'typescript',
      ruby: 'ruby',
      php: 'php',
      shell: 'shell',
      bash: 'shell',
      haskell: 'haskell',
      text: 'plaintext',
      plaintext: 'plaintext'
    };
    return m[lang] || lang || 'plaintext';
  }

  window.createCodeEditor = function (element, lang, content) {
    if (!window.monaco || !window.monaco.editor || !isReady) {
      return simpleCreate ? simpleCreate(element, lang, content) : null;
    }
    element.innerHTML = '';
    var editor = monaco.editor.create(element, {
      value: content || '',
      language: mapLanguage(lang),
      theme: 'tomorrow',
      automaticLayout: true,
      renderWhitespace: 'selection',
      selectionHighlight: true,
      occurrencesHighlight: true,
      stickyTabStops: true,
      scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12 },
      scrollBeyondLastLine: false,
      minimap: { enabled: false }
    });
    return editor;
  };

  window.__onMonacoReady = function () {
    var s = document.createElement('script');
    s.src = (window.pathSelfLib || '') + 'monaco-editor-tomorrow.js';
    s.onload = function(){
      try { monaco.editor.setTheme('tomorrow'); } catch (e) {}
      // Define editors with upstream-like defaults
      try {
        window.createCodeEditor = function (editorElement, language, content) {
          editorElement.innerHTML = '';
          var editor = monaco.editor.create(editorElement, {
            value: content || '',
            language: language,
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
          window.addEventListener('resize', function () { try { editor.layout(); } catch (e) {} });
          return editor;
        };

        window.createMarkdownEditor = function (wrapperElement, content, input) {
          wrapperElement.innerHTML = '';
          var editorElement = document.createElement('div');
          editorElement.classList.add('editor-wrapped');
          wrapperElement.appendChild(editorElement);
          var editor = monaco.editor.create(editorElement, {
            value: content || '',
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
            minimap: { enabled: false },
            hover: { enabled: false },
            wordWrap: 'on',
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
          if (input && input.form) {
            try { input.form.addEventListener('submit', function () { input.value = editor.getValue(); }); } catch (e) {}
          }
          window.addEventListener('resize', function () { try { editor.layout(); } catch (e) {} });
          return editor;
        };
      } catch (e) {}
      flushReady();
    };
    s.onerror = flushReady;
    document.head.appendChild(s);
  };

  window.__initMonaco = function () {
    var vsBase = normalizeBase(window.pathCdnVs || '');
    require.config({
      paths: {
        'vs': vsBase,
        'tokenizer': (window.pathSelfLib || '') + 'vendor/tokenizer'
      },
      ignoreDuplicateModules: [
        'vscode-languageserver-types',
        'vscode-languageserver-types/main',
        'vscode-uri',
        'jsonc-parser'
      ]
    });
    try {
      window.MonacoEnvironment = {
        getWorkerUrl: function(workerId, label) {
          var js = 'self.MonacoEnvironment={baseUrl:"' + vsBase + '/"};importScripts("' + vsBase + '/base/worker/workerMain.js");';
          return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(js);
        }
      };
    } catch (e) {}

    // Load editor first to ensure global monaco is ready
    require(['vs/editor/editor.main'], function(){
      // Then load language contributions in 0.52.2
      require([
        'vs/language/css/monaco.contribution',
        'vs/language/html/monaco.contribution',
        'vs/language/json/monaco.contribution',
        'vs/language/typescript/monaco.contribution'
      ], function(){
        // Then load tokenizer core and definitions dynamically
        try {
          if (window.MonacoAceTokenizer) {
            var langs = (MonacoAceTokenizer.AVAILABLE_LANGUAGES || []).slice();
            var modules = langs.map(function(l){ return 'tokenizer/definitions/' + l; });
            require(modules, function(){
              try {
                if (window.monaco && monaco.languages && Array.isArray(langs)) {
                  langs.forEach(function(l){
                    try { monaco.languages.register({ id: l }); } catch (e) {}
                  });
                // Provide basic language configurations (comments) for non-bundled languages
                var commentsMap = {
                  'c_cpp': { lineComment: '//', blockComment: ['/*','*/'] },
                  'csharp': { lineComment: '//', blockComment: ['/*','*/'] },
                  'java': { lineComment: '//', blockComment: ['/*','*/'] },
                  'pascal': { lineComment: '//', blockComment: ['{','}'] },
                  'python': { lineComment: '#' },
                  'ruby': { lineComment: '#' },
                  'haskell': { lineComment: '--', blockComment: ['{-','-}'] }
                };
                langs.forEach(function(l){
                  var cfg = commentsMap[l];
                  if (cfg) {
                    try { monaco.languages.setLanguageConfiguration(l, { comments: cfg }); } catch (e) {}
                  }
                });
                }
                langs.forEach(function(l){
                  var defKey = l + 'Definition';
                  if (MonacoAceTokenizer[defKey]) {
                    try { MonacoAceTokenizer.registerRulesForLanguage(l, MonacoAceTokenizer[defKey]); } catch (e) {}
                  }
                });
              } catch (e) {}
              window.__onMonacoReady();
            }, function(){
              window.__onMonacoReady();
            });
            return;
          }
        } catch (e) {}
        window.__onMonacoReady();
      }, function(){
        // If language modes fail, still continue
        window.__onMonacoReady();
      });
    }, function(){
      flushReady();
    });
  };

  var loader = document.createElement('script');
  var __vsBaseForLoader = normalizeBase(window.pathCdnVs || '');
  loader.src = __vsBaseForLoader + '/loader.js';
  loader.onload = window.__initMonaco;
  loader.onerror = flushReady;
  document.head.appendChild(loader);
})();
