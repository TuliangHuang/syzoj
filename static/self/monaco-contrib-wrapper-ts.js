define(['vs/language/typescript/monaco.contribution'], function(real){
  try {
    return real;
  } catch (e) {
    console.error('[Monaco Contrib Error] typescript contribution failed:', e);
    return {};
  }
});
