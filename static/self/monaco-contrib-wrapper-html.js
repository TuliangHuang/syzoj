define(['vs/language/html/monaco.contribution'], function(real){
  try {
    return real;
  } catch (e) {
    console.error('[Monaco Contrib Error] html contribution failed:', e);
    return {};
  }
});
