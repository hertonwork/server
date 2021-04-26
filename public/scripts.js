
'use strict';

window.onload = () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js');
        console.info('serviceWorker loaded!');
    }
}
