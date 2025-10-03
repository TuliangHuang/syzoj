define(['vs/language/css/monaco.contribution'], function(real){
  try {
    return real;
  } catch (e) {
    console.error('[Monaco Contrib Error] css contribution failed:', e);
    return {};
  }
});
