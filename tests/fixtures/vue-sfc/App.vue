<script setup lang="ts">
defineProps<{ foo: string }>()

declare global {
  interface Window {
    foo: string
  }
}
</script>

<template>
  <div>Vue SFC</div>
  <slot />
</template>
