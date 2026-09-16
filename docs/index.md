---
layout: false
head:
  - - meta
    - http-equiv: refresh
      content: 0; url=./en/
---

<script setup>
import { onMounted } from 'vue'
import { useData } from 'vitepress'

const { site } = useData()

onMounted(() => {
  const base = site.value.base || '/'
  window.location.replace(`${base}en/`)
})
</script>

<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; text-align: center;">
  <h2>Redirecting to lab-ipxe-os Documentation...</h2>
  <p>If you are not redirected automatically, <a href="./en/">click here to proceed to the English documentation</a>.</p>
</div>
