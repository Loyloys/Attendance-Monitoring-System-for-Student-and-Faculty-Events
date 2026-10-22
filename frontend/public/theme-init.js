try {
  const savedTheme = localStorage.getItem('cot-attendance-theme');
  const isDark = savedTheme === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    isDark ? '#020617' : '#F5F4EC',
  );
} catch (error) {
  console.warn('Could not initialize the saved appearance preference.', error);
}
