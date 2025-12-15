# CHANGELOG - История изменений VoxLux

## [1.0.1] - 2025-12-15

### Исправлено (Bugfixes)

#### 1. Отсутствующий экспорт oiceService 
**Файл:** services/voiceService.ts

**Проблема:** Класс VoiceService был объявлен, но экземпляр не экспортировался. Это приводило к ошибке импорта в App.tsx:
```
import { voiceService } from './services/voiceService';
//  Error: voiceService is not exported
```

**Решение:** Добавлен экспорт экземпляра класса в конец файла:
```typescript
export const voiceService = new VoiceService();
```

---

#### 2. Отсутствующий export default App
**Файл:** App.tsx

**Проблема:** Компонент App был объявлен как const App: React.FC, но не экспортировался по умолчанию. Это приводило к ошибке при импорте в index.tsx:
```
import App from './App';
//  Error: Module has no default export
```

**Решение:** Добавлен экспорт по умолчанию в конец файла:
```typescript
export default App;
```

---

## Статус проекта после исправлений

 Все критические ошибки исправлены  
 Приложение готово к запуску  
 Код соответствует документации в TECHNICAL_DOCS.md
