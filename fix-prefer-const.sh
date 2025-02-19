#!/bin/bash

# 修复 alibaba.ts
sed -i 's/let path =/const path =/g' app/api/alibaba.ts

# 修复 anthropic.ts
sed -i 's/let authHeaderName =/const authHeaderName =/g' app/api/anthropic.ts
sed -i 's/let authValue =/const authValue =/g' app/api/anthropic.ts
sed -i 's/let path =/const path =/g' app/api/anthropic.ts

# 修复 baidu.ts
sed -i 's/let path =/const path =/g' app/api/baidu.ts

# 修复 bytedance.ts
sed -i 's/let path =/const path =/g' app/api/bytedance.ts

# 修复 deepseek.ts
sed -i 's/let path =/const path =/g' app/api/deepseek.ts

# 修复 glm.ts
sed -i 's/let path =/const path =/g' app/api/glm.ts

# 修复 google.ts
sed -i 's/let path =/const path =/g' app/api/google.ts

# 修复 iflytek.ts
sed -i 's/let path =/const path =/g' app/api/iflytek.ts

# 修复 moonshot.ts
sed -i 's/let path =/const path =/g' app/api/moonshot.ts

# 修复 siliconflow.ts
sed -i 's/let path =/const path =/g' app/api/siliconflow.ts
