/** @type {import('next').NextConfig} */
export default {
  serverExternalPackages: ['exceljs'],
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
};
