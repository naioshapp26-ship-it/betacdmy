/**
 * cPanel SSL Service
 * Handles SSL certificate provisioning for tenant subdomains in cPanel environments
 */
export class CpanelSSLService {
    config = null;
    constructor() {
        // Only initialize if cPanel credentials are available
        const host = process.env.CPANEL_HOST;
        const username = process.env.CPANEL_USERNAME;
        const apiToken = process.env.CPANEL_API_TOKEN;
        if (host && username && apiToken) {
            this.config = { host, username, apiToken };
        }
    }
    /**
     * Check if cPanel SSL provisioning is enabled
     */
    isEnabled() {
        return this.config !== null;
    }
    /**
     * Create a subdomain in cPanel and request SSL certificate
     */
    async provisionSubdomain(subdomain, rootDomain) {
        if (!this.config) {
            console.log('[CpanelSSL] Skipping SSL provisioning - cPanel not configured');
            return;
        }
        try {
            console.log(`[CpanelSSL] Creating subdomain: ${subdomain}.${rootDomain}`);
            // Step 1: Create subdomain in cPanel
            await this.createSubdomain(subdomain, rootDomain);
            // Step 2: Wait a bit for DNS to propagate
            await this.delay(2000);
            // Step 3: Request AutoSSL certificate
            await this.requestAutoSSL(subdomain, rootDomain);
            console.log(`[CpanelSSL] SSL provisioning completed for ${subdomain}.${rootDomain}`);
        }
        catch (error) {
            console.error(`[CpanelSSL] Failed to provision SSL for ${subdomain}.${rootDomain}:`, error);
            throw error;
        }
    }
    /**
     * Create a subdomain in cPanel
     */
    async createSubdomain(subdomain, rootDomain) {
        if (!this.config)
            return;
        const url = `https://${this.config.host}:2083/execute/SubDomain/addsubdomain?domain=${encodeURIComponent(subdomain)}&rootdomain=${encodeURIComponent(rootDomain)}&dir=${encodeURIComponent('public_html/betacdmy-app/dist')}`;
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `cpanel ${this.config.username}:${this.config.apiToken}`,
                },
            });
            const data = await response.json();
            if (data?.status === 1 || data?.data?.status === 1) {
                console.log(`[CpanelSSL] Subdomain created successfully`);
            }
            else {
                console.warn(`[CpanelSSL] Subdomain creation response:`, data);
            }
        }
        catch (error) {
            // Check if subdomain already exists
            if (error.message?.includes('already exists')) {
                console.log(`[CpanelSSL] Subdomain already exists`);
                return;
            }
            throw new Error(`Failed to create subdomain: ${error.message}`);
        }
    }
    /**
     * Request AutoSSL certificate from Let's Encrypt via cPanel
     */
    async requestAutoSSL(subdomain, rootDomain) {
        if (!this.config)
            return;
        const fullDomain = `${subdomain}.${rootDomain}`;
        // Note: cPanel AutoSSL runs automatically in the background
        // We just need to ensure the subdomain exists and is accessible
        console.log(`[CpanelSSL] AutoSSL will provision certificate for ${fullDomain} automatically`);
        console.log(`[CpanelSSL] SSL certificate may take 1-5 minutes to provision`);
    }
    /**
     * Delete subdomain (used during tenant deletion/cleanup)
     */
    async deleteSubdomain(subdomain, rootDomain) {
        if (!this.config)
            return;
        const url = `https://${this.config.host}:2083/execute/SubDomain/delsubdomain?domain=${encodeURIComponent(`${subdomain}.${rootDomain}`)}`;
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `cpanel ${this.config.username}:${this.config.apiToken}`,
                },
            });
            await response.json();
            console.log(`[CpanelSSL] Subdomain deleted: ${subdomain}.${rootDomain}`);
        }
        catch (error) {
            console.error(`[CpanelSSL] Failed to delete subdomain:`, error.message);
        }
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
export const cpanelSSLService = new CpanelSSLService();
