import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import { bootstrap } from './bootstrap';

createApp(App, { items: bootstrap.items }).mount('#app');
