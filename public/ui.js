// Tahap 4 (tata letak): laci pengaturan dari topbar.
// Memakai helper $ dari app.js. Dimuat paling akhir.

const drawer = $('drawer');
const drawerBackdrop = $('drawerBackdrop');

function openDrawer() {
  drawer.hidden = false;
  drawerBackdrop.hidden = false;
}

function closeDrawer() {
  drawer.hidden = true;
  drawerBackdrop.hidden = true;
}

$('btnSettings').addEventListener('click', openDrawer);
$('btnCloseDrawer').addEventListener('click', closeDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
});
