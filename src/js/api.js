import xmlParser from "fast-xml-parser";

export class Api {
    constructor(app) {
        this.app = app;
        this.app.api = this;
        this.app.cu_url = this.app.storage.cuApiURL;

        const settings = this.app.storage.getSettings();
        if (settings.devMode && settings.testApi) {
            this.url = this.app.storage.testApiURL;
        } else {
            this.url = this.app.storage.prodApiURL;
        }
    }

    async requestLogin(username, password) {
        var self = this;
        var app = self.app;

        return await app.request.promise.post(app.api.url + "auth", {
            "user": username,
            "password": password,
            "app_id": "1"
        }).then( async (res) => {
			let data = JSON.parse(res.data);
			app.storage.setUserData(data.user);
            if (data.passport) {
                let cuAuth = await this.cuAuth(username, password);
                if (cuAuth) {
                    data.cu_auth = cuAuth;
                }
                app.storage.setUserCredentials(data);
                app.request.setup({
                    headers: {
                        Authorization: "Bearer " + data.passport,
                    },
                });
                const settings = app.storage.getSettings();
                if (settings.allowNotifications) {
                    await self.postFcmToken();
                }
                return true;
            } else {
                return false;
            }
        }).catch((err) => {
            return false;
        });
    };

    async requestLogout() {
        var self = this;
        var app = self.app;

        await self.deleteFcmToken();
        app.storage.removeAllButUserData();
        app.storage.clearUserCredentials();
        app.request.setup({
            headers: {
                Authorization: "",
            },
        });
        return true;
    };

    // News methods
    async getNews() {
        var self = this;
        var app = self.app;

        return await app.request.promise.get("https://practice.uffs.edu.br/feed.xml").then((res) => {
            let xmlParser = require("fast-xml-parser");
            let feed = xmlParser.parse(res.data);
            let news = feed.rss.channel.item;

            for (let i = 0; i < news.length; i++) {
                const content = app.storage.processHTML(news[i].content);
                news[i].content = content;

                const pubDate = app.storage.formatDate(news[i].pubDate);
                news[i].pubDate = pubDate;
            }
            return news;
        });
    };

    async requestUserData() {
        var self = this;
        var app = self.app;

        return await app.request.promise.post(app.api.url + "auth/me")
        .then((res) => {
            let data = JSON.parse(res.data);
            if(data.error){
                this.requestLogout().then(res => {
                    if (res) {
                        app.dialog.alert(
                            "Sessão expirada ou inválida, faça login novamente!"
                        );
                        app.views.main.router.navigate("/");
                    }
                });
                return;
            }
            const userData = JSON.parse(res.data);
            app.storage.setUserData(userData);
            return userData;
        });
    };

    async getRequestedServices(page = 1) {
        var self = this;
        var app = self.app;
        return await app.request.promise
        .get(app.api.url + "mural/orders?page="+page)
        .then((res) => {
            let data = JSON.parse(res.data);
            if(data.error){
                app.storage.requestLogout().then(res => {
                    if (!res) {
                        return;
                    }
                    app.dialog.alert("Sessão expirada ou inválida, faça login novamente!");
                    app.views.main.router.navigate("/");
                })
                return;
            }
            let services = JSON.parse(res.data).data;
            let servicesToSave = [];
            let toReturn = {
                services: [],
                meta: data.meta
            };

            for (let i = 0; i < services.length; i++) {
                servicesToSave[i] = {
                    id: services[i].id,
                    status: services[i].status,
                    title: services[i].title,
                    description: services[i].description,
                    created_at: services[i].created_at
                };

                toReturn.services[i] = services[i];
            }

            const settings = app.storage.getSettings();

            if (settings.offlineStorage) {
                app.storage.setRequestedServices(servicesToSave);
            }
            return toReturn;
        });
    };

    async getServiceById(id) {
        var self = this;
        var app = self.app;
        return await app.storage.getUserData().then(async (userData) => {
            return await app.request.promise
            .get(app.api.url + "mural/orders/" + id)
            .then((res) => {
                let data = JSON.parse(res.data);
                if(data.error){
                    app.storage.requestLogout().then(res => {
                        if (!res) {
                            return;
                        }
                        app.dialog.alert("Sessão expirada ou inválida, faça login novamente!");
                        app.views.main.router.navigate("/");
                    })
                    return;
                }
                let service = JSON.parse(res.data);

                service.comments.forEach(comment => {
                    comment.user_name = comment.user_id != service.user_id ? "Equipe PRACTICE" : userData.name;
                    comment.created_at = new Date(comment.created_at).toLocaleDateString("pt-br", {timeZone: 'UTC'});
                });

                service.requested_due_date = new Date(service.requested_due_date).toLocaleDateString("pt-br", {timeZone: 'UTC'});
                service.user = userData;

                const settings = app.storage.getSettings();

                if (settings.offlineStorage && !service.error) {
                    app.storage.setServiceDetails(service);
                }
                return service;
            });
        });
    };

    async requestUserFromMural() {
        var self = this;
        var app = self.app;

        return await app.request.promise.get(app.api.url + "mural/me")
        .then((res) => {
            let data = JSON.parse(res.data);
            if(data.error){
                this.requestLogout().then(res => {
                    if (res) {
                        app.dialog.alert(
                            "Sessão expirada ou inválida, faça login novamente!"
                        );
                        app.views.main.router.navigate("/");
                    }
                });
                return;
            }
            return data.user;
        });
    }

    async postCommentByServiceId(service_id, comment){
        var self = this;
        var app = self.app;

        return await app.api.requestUserFromMural().then(async (userData) => {
            var newComment = {
                content: comment.text,
                is_hidden: 0,
                user_id: userData.id,
                commentable_id: service_id,
                commentable_type: "App\\Models\\Order"
            }

            return await app.request.promise.post(app.api.url + "mural/comments", newComment).then((res) => {
                let data = JSON.parse(res.data);
                if(data.error){
                    app.storage.requestLogout().then(res => {
                        if (!res) {
                            return;
                        }
                        app.dialog.alert("Sessão expirada ou inválida, faça login novamente!");
                        app.views.main.router.navigate("/");
                    });
                    return;
                }
                return true;
            });
        });
    };

    async postFcmToken(){
        var self = this;
        var app = self.app;

        document.addEventListener('deviceready', () => {
            cordova.plugins.firebase.messaging.getToken().then(async function(token) {
                app.storage.setFcmToken(token);
                const data = {
                    fcm_token: token
                }

                return await app.request.promise.post(app.api.url + "user/channels", data).then( async (res) => {
                    let responseData = JSON.parse(res.data)
                    if(!responseData.id) {
                        return await self.updateFcmToken();
                    }
                }).catch(async (err) => {
                    return await self.updateFcmToken();
                })
            });
        });
    };

    async updateFcmToken(){
        var self = this;
        var app = self.app;

        document.addEventListener('deviceready', async () => {
            cordova.plugins.firebase.messaging.getToken().then(async function (token) {
                app.storage.setFcmToken(token);
                const data = {
                    fcm_token: token
                }
                let userToken = JSON.parse(localStorage["userCredentials"]);
                userToken = "Bearer " + userToken.passport;

                return await app.request.promise({
                    url: app.api.url + "user/channels",
                    method: "PATCH",
                    contentType: "application/json",
                    headers: {
                        Authorization: userToken
                    },
                    data: data,
                }).then((res) => {
                    let responseData = JSON.parse(res.data)
                    if (responseData.error) {
                        app.dialog.alert("Não foi possível ativar as notificações para este dispositivo, tente novamente mais tarde!");
                    }
                }).catch(() => {
                    app.dialog.alert("Não foi possível ativar as notificações para este dispositivo, tente novamente mais tarde!");
                });
            });
        });
    };

    async deleteFcmToken(){
        var self = this;
        var app = self.app;

        document.addEventListener('deviceready', async () => {
            let userToken = JSON.parse(localStorage["userCredentials"]);
            userToken = "Bearer " + userToken.passport;
            app.storage.removeFcmToken();
            return await app.request.promise({
                url: app.api.url+"user/channels",
                method: "DELETE",
                headers: {
                    Authorization: userToken
                }
            });
        });
    };

    // CU Methods
    async cuAuth(uid, password) {
        let app = this.app;

        return await app.request.promise.post(app.cu_url + 'login', {
            "uid": uid,
            "password": password,
        }).then(async (res) => {
            let data = JSON.parse(res.data);
            return data.success ? data.data.token : false;
        }).catch((err) => {
            return false;
        })
    }

    async getCuStatus() {
        let app = this.app;
        let userData = await app.storage.getUserData()

        return await app.request.promise
            .get(app.cu_url + 'user/operation/' + userData['username'])
            .then(
                async res => {
                    if (res.status == 204) {
                        return { 'noUser' : true }
                    }

                    res = JSON.parse(res.data);
                    let cuData = null;

                    if (res.data == 'User has no operation in progress.') {
                        cuData = await app.storage.getCuData();
                    }

                    return {
                        'creationError': res.data.status == "Falha",
                        'creatingStatus': res.data.status,
                        'message': res.data.message,
                        'cuData': cuData,
                        'needLogout': cuData === false
                    };
                }
            );
    }

    async requestCuData() {
        let self = this;
        let app = self.app;
        let credentials = app.storage.getUserCredentials()

        if (!credentials.hasOwnProperty('cu_auth')) {
            return false;
        }

        return await app.request.promise({
            type: 'GET',
            url: app.cu_url + 'user',
            contentType: "application/json; charset=utf-8",
            crossDomain: true,
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Access-Control-Allow-Origin", "*");
                xhr.setRequestHeader('Authorization', "Bearer " +  credentials.cu_auth);
            }
        }).then((res) => {
            const cuData = JSON.parse(res.data);
            if (cuData.success) {
                let birth_date = cuData.data.birth_date.split(' ')[0];
                birth_date = birth_date.split('-');
                cuData.data.birth_date = new Date(birth_date[0], birth_date[1]-1, birth_date[2]);
                cuData.data.birth_date = cuData.data.birth_date.toLocaleDateString('pt-br');

                app.storage.setCuData(cuData.data);
                return cuData.data;
            }
        });
    };

    async requestIdCard(data, photo=null) {
        let app = this.app;
        let credentials = await app.storage.getUserCredentials();
        let update = !data.hasOwnProperty('user-uid');

        let args = {
            enrollment_id: data['user-enrollment_id'],
            birth_date: data['user-birth_date']
        }

        if (photo != null) {
            args.profile_photo = photo;
        }

        if (!update) {
            args.uid = data['user-uid'];
            args.password = data['user-password'];
        }

        let post = {
            type: update ? 'PATCH' : 'POST',
            url: app.cu_url + 'user/iduffs',
            data: JSON.stringify(args),
            contentType: "application/json; charset=utf-8",
            crossDomain: true
        };

        if (credentials.hasOwnProperty('cu_auth')) {
            post.beforeSend = function (xhr) {
                xhr.setRequestHeader("Access-Control-Allow-Origin", "*");
                xhr.setRequestHeader('Authorization', "Bearer " + credentials.cu_auth);
            }
        }

        return await app.request.promise(post).then(res => res);
    }

    async getCCRs () {
        let app = this.app;
        let credentials = await app.storage.getUserCredentials();
        return await app.request.promise({
            type: 'GET',
            url: app.cu_url + 'ccr',
            contentType: "application/json; charset=utf-8",
            crossDomain: true,
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Access-Control-Allow-Origin", "*");
                xhr.setRequestHeader('Authorization', "Bearer " + credentials.cu_auth);
            }
        }).then(res => {
            return JSON.parse(res.data).data.data;
        });
    }

    async requestRoomSchedule(data) {
        let app = this.app;
        let credentials = await app.storage.getUserCredentials();

        console.log(data)

        if (!credentials.hasOwnProperty('cu_auth')) {
            // TODO: Criar resposta de usuário não autenticado
            return;
        }

        let schedule = {
            begin: data['schedule-begin'],
            end: data['schedule-end'],
            description: data['schedule-description'],
            room_id: data['schedule-room_id'],
            ccr_id: data['schedule-ccr'],
        };

        return await app.request.promise({
            type: 'POST',
            url: app.cu_url + 'reserve',
            data: JSON.stringify(schedule),
            contentType: "application/json; charset=utf-8",
            crossDomain: true,
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Access-Control-Allow-Origin", "*");
                xhr.setRequestHeader('Authorization', "Bearer " + credentials.cu_auth);
            }
        }).then(res => res);
    }
};