define(['vs/language/json/monaco.contribution'], function(real){
  try {
    return real;
  } catch (e) {
    console.error('[Monaco Contrib Error] json contribution failed:', e);
    return {};
  }
});
