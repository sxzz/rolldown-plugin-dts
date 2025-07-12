<script setup lang="ts">
import Comp from './Comp.vue'

defineProps<{ foo: string }>()
</script>

<template>
  <Comp bar="baz" />
</template>
