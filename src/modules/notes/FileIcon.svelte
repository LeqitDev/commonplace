<script lang="ts">
	// Tree icon for an uploaded file, by MIME type.
	import File from '@lucide/svelte/icons/file';
	import FileImage from '@lucide/svelte/icons/file-image';
	import FileVideo from '@lucide/svelte/icons/file-video';
	import FileAudio from '@lucide/svelte/icons/file-audio';
	import FileText from '@lucide/svelte/icons/file-type';
	import FileArchive from '@lucide/svelte/icons/file-archive';
	import FileCode from '@lucide/svelte/icons/file-code';

	let { mime = '', class: className }: { mime?: string; class?: string } = $props();
	const Icon = $derived(
		mime.startsWith('image/')
			? FileImage
			: mime.startsWith('video/')
				? FileVideo
				: mime.startsWith('audio/')
					? FileAudio
					: mime === 'application/pdf' || mime.startsWith('text/')
						? FileText
						: /zip|tar|compress|7z|rar/.test(mime)
							? FileArchive
							: /json|javascript|xml|x-sh/.test(mime)
								? FileCode
								: File
	);
</script>

<Icon class={className} />
