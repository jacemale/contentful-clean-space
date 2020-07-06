import { createClient } from "contentful-management";
import * as inquirer from "inquirer";
import * as ProgressBar from "progress";
import * as yargs from "yargs";
import { Space } from "contentful-management/typings/space";
import { Entry } from "contentful-management/typings/entry";
import { Environment } from "contentful-management/typings/environment";

export async function main() {
    const argv = yargs.env()
        .option("space-id", {
            type: "string",
            describe: "Contentful space id",
            demandOption: true
        }).option("env", {
            type: "string",
            describe: "Contentful environment",
            default: "master",
            demandOption: false
        }).option("accesstoken", {
            type: "string",
            describe: "Contentful access token",
            demandOption: true
        }).option("content-type", {
            type: "string",
            describe: "Content type to be removed",
        }).option("batch-size", {
            type: "number",
            describe: "Number of parallel contentful requests",
            default: 5
        }).option("content-types", {
            type: "boolean",
            describe: "Delete content types as well",
            default: false
        }).option("yes", {
            type: "boolean",
            describe: "Auto-confirm delete prompt",
            alias: "y",
            default: false
        }).option("verbose", {
            type: "boolean",
            alias: "v",
            default: false
        }).option("ignorelist", {
            type: "string",
            describe: "File with IDs to ignore",
            alias: "i",
            default: undefined
        }).option("removelist", {
            type: "string",
            describe: "File with IDs to remove",
            alias: "r",
            default: undefined
        }).version(false)
        .parse();
    const accessToken: string = argv["accesstoken"];
    const spaceId: string = argv["space-id"];
    const verbose: boolean = argv["verbose"];
    const batchSize: number = argv["batch-size"];
    const contentType: string | undefined = argv["content-type"];
    const isContentTypes: boolean = argv["content-types"];
    const yes: boolean = argv["yes"];
    const ignorelist: string | undefined = argv["ignorelist"];
    const removelist: string | undefined = argv["removelist"];

    const env: string = argv["env"] || 'master';

    const contentfulManagementClient = createClient({
        accessToken
    });
    console.log(`Opening Contentful space "${spaceId}"`);
    const contentfulSpace = await contentfulManagementClient.getSpace(spaceId);
    console.log(`Using space "${spaceId}" (${contentfulSpace.name})`);
    let filter: (entry: Entry) => boolean = () => true;

    if (ignorelist) {
        let list: Array<string> = require('fs').readFileSync(ignorelist, 'utf-8').split(/\r?\n/);
        filter = e => !list.some(id => id == e.sys.id);
    } else if (removelist) {
        let list: Array<string> = require('fs').readFileSync(removelist, 'utf-8').split(/\r?\n/);
        filter = e => list.some(id => id == e.sys.id);
    }

    if (!yes) {
        if (!await promptForEntriesConfirmation(spaceId, env))
            return;
    }
    await deleteEntries(contentfulSpace, contentType, batchSize, verbose, env, filter);

    if (isContentTypes) {
        if (!yes) {
            if (!await promptForContentTypesConfirmation(spaceId, env))
                return;
        }
        await deleteContentTypes(contentfulSpace, batchSize, verbose, env);
    }
}

async function promptForEntriesConfirmation(spaceId: string, environment: string) {
    const a: any = await inquirer.prompt([{
        type: "confirm",
        name: "yes",
        message: `Do you really want to delete all entries from space ${spaceId}:${environment}?`
    }]);
    return a.yes;
}

async function promptForContentTypesConfirmation(spaceId: string, environment: string) {
    const a: any = await inquirer.prompt([{
        type: "confirm",
        name: "yes",
        message: `Do you really want to delete all content types from space ${spaceId}:${environment}?`
    }]);
    return a.yes;
}

async function deleteEntries(contentfulSpace: Space, contentType: string | undefined, batchSize: number, verbose: boolean, environment: string, filter: (e: Entry) => Boolean) {
    const selectedEnvironment = await contentfulSpace.getEnvironment(environment);
    const entriesMetadata = await selectedEnvironment.getEntries({
        include: 0,
        limit: 0,
        content_type: contentType
    });
    let totalEntries = entriesMetadata.total;
    console.log(`Deleting ${totalEntries} entries`);

    let offset = 0;
    // tslint:disable-next-line:max-line-length
    const entriesProgressBar = new ProgressBar("Deleting entries [:bar], rate: :rate/s, done: :percent, time left: :etas", { total: totalEntries });
    do {
        const entries = await selectedEnvironment.getEntries({
            include: 0,
            skip: offset,
            limit: batchSize,
            content_type: contentType
        });
        totalEntries = entries.total;

        const promises: Array<Promise<boolean>> = [];
        for (const entry of entries.items.filter(e => filter(e))) {
            const promise = unpublishAndDeleteEntry(selectedEnvironment, entry, entriesProgressBar, verbose);
            promises.push(promise);
        }
        let results = await Promise.all(promises);
        offset += entries.limit - results.filter(r => r).length;
    } while (totalEntries > batchSize);
}

async function unpublishAndDeleteEntry(contentfulEnv: Environment, entry: Entry, progressBar: ProgressBar, verbose: boolean) {
    try {
        if (!entry.isPublished() && !entry.isUpdated()) {
            if (entry.fields.seriesList) {
                for (const series of entry.fields.seriesList["en-GB"]) {
                    try {
                        let seriesEntry = await contentfulEnv.getEntry(series.sys.id);
                        await unpublishAndDeleteEntry(contentfulEnv, seriesEntry, progressBar, verbose);
                    } catch (e) {
                        console.log(e);
                    }
                }
            }
            if (entry.fields.episodeList) {
                for (const episode of entry.fields.episodeList["en-GB"]) {
                    try {
                        let episodeEntry = await contentfulEnv.getEntry(episode.sys.id);
                        await unpublishAndDeleteEntry(contentfulEnv, episodeEntry, progressBar, verbose);
                    } catch (e) {
                        console.log(e);
                    }
                }
            }
            console.log(`Deleting entry ${entry.sys.contentType.sys.id} '${entry.sys.id}"`);
            await entry.delete();
            progressBar.tick();
            return true;
        }
        progressBar.tick();
        return false;
    } catch (e) {
        progressBar.tick();
        console.log(e);
        return false;
        // Continue if something went wrong with Contentful
    }
}

async function deleteContentTypes(contentfulSpace: any, batchSize: number, verbose: boolean, environment: string) {
    const selectedEnvironment = await contentfulSpace.getEnvironment(environment);
    const contentTypesMetadata = await selectedEnvironment.getContentTypes({
        include: 0,
        limit: 0
    });
    let totalContentTypes = contentTypesMetadata.total;
    console.log(`Deleting ${totalContentTypes} content types`);

    // tslint:disable-next-line:max-line-length
    const contentTypesProgressBar = new ProgressBar("Deleting content types [:bar], rate: :rate/s, done: :percent, time left: :etas", { total: totalContentTypes });
    do {
        const contentTypes = await contentfulSpace.getContentTypes({
            include: 0,
            limit: batchSize
        });
        totalContentTypes = contentTypes.total;

        const promises: Array<Promise<void>> = [];
        for (const contentType of contentTypes.items) {
            const promise = unpublishAndDeleteContentType(contentType, contentTypesProgressBar, verbose, environment);
            promises.push(promise);
        }
        await Promise.all(promises);
    } while (totalContentTypes > batchSize);
}

async function unpublishAndDeleteContentType(contentType: any, progressBar: ProgressBar, verbose: boolean, environment: string) {
    try {
        if (contentType.isPublished()) {
            if (verbose)
                console.log(`Unpublishing content type "${contentType.sys.id}"`);
            await contentType.unpublish();
        }
        if (verbose)
            console.log(`Deleting content type '${contentType.sys.id}"`);
        await contentType.delete();
    } catch (e) {
        console.log(e);
        // Continue if something went wrong with Contentful
    } finally {
        progressBar.tick();
    }
}
