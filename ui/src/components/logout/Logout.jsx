/*
 * Copyright (c) 2025 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import { xhrPost } from '../../services/xhr';
import { IconUser } from '@douyinfe/semi-icons';

const Logout = function Logout({ text }) {
  const showText = Boolean(text);
  const icon = <IconUser />;

  return (
    <div>
      <Button
        icon={showText ? icon : null}
        type="danger"
        theme="solid"
        aria-label="Logout"
        onClick={async () => {
          await xhrPost('/api/login/logout');
          location.reload();
        }}
      >
        {showText ? 'Logout' : icon}
      </Button>
    </div>
  );
};

export default Logout;
