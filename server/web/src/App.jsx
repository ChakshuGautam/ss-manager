import React from 'react';
import { Admin, Resource, defaultDarkTheme, defaultLightTheme } from 'react-admin';
import ScreenshotIcon from '@mui/icons-material/Screenshot';
import dataProvider from './dataProvider';
import { ScreenshotList } from './ScreenshotList';

const App = () => (
  <Admin
    dataProvider={dataProvider}
    darkTheme={defaultDarkTheme}
    theme={defaultLightTheme}
    title="SS Manager"
  >
    <Resource
      name="screenshots"
      list={ScreenshotList}
      icon={ScreenshotIcon}
      options={{ label: 'Screenshots' }}
    />
  </Admin>
);

export default App;
